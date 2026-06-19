/**
 * Web Worker — runs ONNX inference off the main thread.
 *
 * Protocol:
 *  Main → Worker  { type:'init', modelSrc: string | ArrayBuffer }
 *  Worker → Main  { type:'ready', ep: string }
 *
 *  Main → Worker  { type:'changeModel', modelSrc: string | ArrayBuffer }
 *  Worker → Main  { type:'ready', ep: string }
 *
 *  Main → Worker  { type:'infer', pixels: ArrayBuffer (transferred),
 *                   scale, padX, padY }
 *  Worker → Main  { type:'result', detections: Detection[] }
 *
 *  Worker → Main  { type:'error', message: string }  (on any failure)
 */

import * as ort from 'onnxruntime-web';

ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;

// Relay uncaught errors and unhandled rejections to the main thread so they
// appear in the debug log. These fire for module-level failures (e.g. ORT
// initialisation) before the message handler is registered.
self.addEventListener('error', (e: ErrorEvent) => {
  self.postMessage({ type: 'error', message: `uncaught: ${e.message} (${e.filename}:${e.lineno})` });
});
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  self.postMessage({ type: 'error', message: `unhandled rejection: ${String(e.reason)}` });
});

// ── Constants (must match detector.ts) ───────────────────────────────────────

const MODEL_W = 1280;
const MODEL_H = 1280;
const LABELS = ['plate', 'person'] as const;
const THRESHOLD_IOU = 0.45;
const THRESHOLD_CONF = 0.01;
const MAX_NMS_CANDIDATES_PER_CLASS = 1500;

// ── State ─────────────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let resolvedEps: string[] | null = null;

// ── EP probing ────────────────────────────────────────────────────────────────

async function resolveEps(): Promise<string[]> {
  if (resolvedEps !== null) return resolvedEps;
  const eps: string[] = [];
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = (
        navigator as unknown as {
          gpu: { requestAdapter(opts: object): Promise<{ requestDevice(): Promise<GPUDevice> } | null> };
        }
      ).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        ort.env.webgpu.device = (await adapter.requestDevice()) as unknown as GPUDevice;
        eps.push('webgpu');
      }
    } catch {
      /* skip */
    }
  }
  eps.push('wasm');
  resolvedEps = eps;
  return eps;
}

// ── Session management ────────────────────────────────────────────────────────

async function createSession(modelSrc: string | ArrayBuffer): Promise<string> {
  if (session) {
    await (session as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    session = null;
  }
  const eps = await resolveEps();
  console.log('[detector worker] execution providers:', eps);
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session = await ort.InferenceSession.create(modelSrc as any, { executionProviders: subset });
      console.log(`[detector worker] session created EPs: ${subset.join(', ')}`);
      return subset[0];
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[detector worker] EP "${eps[i]}" failed:`, err);
      else throw err;
    }
  }
  throw new Error('No working execution provider');
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

// Reused across calls — worker handles one inference at a time (sequential protocol).
const _tensorBuf = new Float32Array(3 * MODEL_W * MODEL_H);

function buildTensor(data: Uint8ClampedArray): ort.Tensor {
  const t0 = performance.now();
  const pixels = MODEL_W * MODEL_H;
  const tensor = _tensorBuf;
  for (let i = 0; i < pixels; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[pixels + i] = data[i * 4 + 1] / 255;
    tensor[pixels * 2 + i] = data[i * 4 + 2] / 255;
  }
  console.log(`[detector worker] buildTensor ${(performance.now() - t0).toFixed(1)}ms`);
  return new ort.Tensor('float32', tensor, [1, 3, MODEL_H, MODEL_W]);
}

// ── Postprocessing & NMS ──────────────────────────────────────────────────────

interface RawBox {
  label: 'plate' | 'person';
  conf: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

function iou(a: RawBox, b: RawBox): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2, ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2, bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy, union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

interface Detection {
  label: 'plate' | 'person';
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function postprocess(output: ort.Tensor, scale: number, padX: number, padY: number): Detection[] {
  const data = output.data as Float32Array;
  const [, rows, cols] = output.dims as [number, number, number];

  const rawByClass: RawBox[][] = LABELS.map(() => []);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const objConf = data[base + 4];
    if (objConf < THRESHOLD_CONF) continue;
    const cx = data[base], cy = data[base + 1], w = data[base + 2], h = data[base + 3];
    for (let c = 0; c < LABELS.length; c++) {
      const conf = objConf * data[base + 5 + c];
      if (conf < THRESHOLD_CONF) continue;
      rawByClass[c].push({ label: LABELS[c], conf, cx, cy, w, h });
    }
  }

  const kept: RawBox[] = [];
  for (const classRaw of rawByClass) {
    classRaw.sort((a, b) => b.conf - a.conf);
    if (classRaw.length > MAX_NMS_CANDIDATES_PER_CLASS) {
      console.log(`[detector worker] capping ${classRaw[0].label} candidates ${classRaw.length} → ${MAX_NMS_CANDIDATES_PER_CLASS}`);
      classRaw.splice(MAX_NMS_CANDIDATES_PER_CLASS);
    }
    const sup = new Uint8Array(classRaw.length);
    for (let i = 0; i < classRaw.length; i++) {
      if (sup[i]) continue;
      kept.push(classRaw[i]);
      for (let j = i + 1; j < classRaw.length; j++) {
        if (!sup[j] && iou(classRaw[i], classRaw[j]) > THRESHOLD_IOU) sup[j] = 1;
      }
    }
  }

  return kept.map((b) => ({
    label: b.label,
    conf: b.conf,
    x: Math.round((b.cx - b.w / 2 - padX) / scale),
    y: Math.round((b.cy - b.h / 2 - padY) / scale),
    w: Math.round(b.w / scale),
    h: Math.round(b.h / scale),
  }));
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', (e: MessageEvent) => {
  void (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = e.data as Record<string, any>;
    try {
      if (msg.type === 'init' || msg.type === 'changeModel') {
        const ep = await createSession(msg.modelSrc as string | ArrayBuffer);
        self.postMessage({ type: 'ready', ep });
      } else if (msg.type === 'infer') {
        const pixels = new Uint8ClampedArray(msg.pixels as ArrayBuffer);
        const tensor = buildTensor(pixels);
        const t0 = performance.now();
        const results = await session!.run({ [session!.inputNames[0]]: tensor });
        console.log(`[detector worker] session.run ${(performance.now() - t0).toFixed(1)}ms`);
        const detections = postprocess(
          results[session!.outputNames[0]],
          msg.scale as number,
          msg.padX as number,
          msg.padY as number,
        );
        self.postMessage({ type: 'result', detections });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  })();
});
