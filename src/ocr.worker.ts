/**
 * Web Worker — runs PaddleOCR English recognition inference off the main thread.
 *
 * Protocol:
 *  Main → Worker  { type:'init', modelUrl: string, dictUrl: string }
 *  Worker → Main  { type:'ready' }
 *
 *  Main → Worker  { type:'recognize', id: number,
 *                   pixels: ArrayBuffer (transferred), width: number, height: number }
 *  Worker → Main  { type:'result', id: number, text: string }
 *
 *  Worker → Main  { type:'error', message: string }
 */

import * as ort from 'onnxruntime-web';

ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;

// Relay uncaught errors to main thread.
self.addEventListener('error', (e: ErrorEvent) => {
  self.postMessage({ type: 'error', message: `uncaught: ${e.message} (${e.filename}:${e.lineno})` });
});
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  self.postMessage({ type: 'error', message: `unhandled rejection: ${String(e.reason)}` });
});

// ── Constants ────────────────────────────────────────────────────────────────

const REC_HEIGHT = 48;

// ── State ────────────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let dictionary: string[] = []; // index → character
let blankIdx = 0; // CTC blank token index (= dict length)
let resolvedEps: string[] | null = null;

// ── EP probing ───────────────────────────────────────────────────────────────

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

// ── Session management ───────────────────────────────────────────────────────

async function createSession(modelUrl: string): Promise<void> {
  if (session) {
    await (session as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    session = null;
  }
  const eps = await resolveEps();
  console.log('[ocr worker] execution providers:', eps);
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session = await ort.InferenceSession.create(modelUrl as any, { executionProviders: subset });
      console.log(`[ocr worker] session created EPs: ${subset.join(', ')}`);
      return;
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[ocr worker] EP "${eps[i]}" failed:`, err);
      else throw err;
    }
  }
  throw new Error('No working execution provider');
}

async function loadDictionary(dictUrl: string): Promise<void> {
  const res = await fetch(dictUrl);
  if (!res.ok) throw new Error(`Failed to fetch dictionary: HTTP ${res.status}`);
  const text = await res.text();
  // monkt/paddleocr-onnx dict format: one character per line.
  // PaddleOCR CTC convention: blank token at index 0, characters at indices 1..N.
  // Prepend an empty entry so dict[0] = blank, dict[1] = first char, etc.
  dictionary = [''];
  for (const line of text.split('\n')) {
    if (line.length > 0) dictionary.push(line);
  }
  blankIdx = 0;
  console.log(`[ocr worker] dictionary loaded: ${dictionary.length - 1} chars, blank=${blankIdx}`);
}

// ── Preprocessing ────────────────────────────────────────────────────────────

function buildTensor(pixels: Uint8ClampedArray, width: number, height: number): ort.Tensor {
  // Input is RGBA pixels at the target size (height=48, width=variable).
  // Output: [1, 3, height, width] float32 normalized to [0, 1].
  // This model uses simple /255 normalization (NOT ImageNet mean/std).
  const c = 3;
  const tensor = new Float32Array(c * height * width);
  const pixelCount = height * width;
  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = pixels[i * 4] / 255;
    tensor[pixelCount + i] = pixels[i * 4 + 1] / 255;
    tensor[pixelCount * 2 + i] = pixels[i * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', tensor, [1, c, height, width]);
}

// ── CTC decode ───────────────────────────────────────────────────────────────

function ctcDecode(output: ort.Tensor): string {
  const data = output.data as Float32Array;
  const [, seqLen, vocabSize] = output.dims as [number, number, number];
  let prev = -1;
  const chars: string[] = [];
  for (let t = 0; t < seqLen; t++) {
    // Argmax over vocabulary at timestep t
    let maxIdx = 0;
    let maxVal = data[t * vocabSize];
    for (let v = 1; v < vocabSize; v++) {
      const val = data[t * vocabSize + v];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = v;
      }
    }
    // CTC collapse: skip blank and consecutive duplicates
    if (maxIdx !== blankIdx && maxIdx !== prev) {
      const ch = dictionary[maxIdx] ?? '';
      chars.push(ch);
    }
    prev = maxIdx;
  }
  // Filter to A-Z 0-9 ÄÖÜ only (license plate characters)
  return chars.filter((c) => /^[A-ZÄÖÜ0-9]$/i.test(c)).join('').toUpperCase();
}

// ── Message handler ──────────────────────────────────────────────────────────

// Serialize all message processing so only one session.run() is active at a
// time.  The ONNX WebGPU backend throws "Session already started" when
// concurrent runs hit the same session.
let taskQueue: Promise<void> = Promise.resolve();

async function handleMessage(msg: Record<string, unknown>): Promise<void> {
  try {
    if (msg.type === 'init') {
      await loadDictionary(msg.dictUrl as string);
      await createSession(msg.modelUrl as string);
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'recognize') {
      if (!session) throw new Error('Session not initialized');
      const pixels = new Uint8ClampedArray(msg.pixels as ArrayBuffer);
      const inputTensor = buildTensor(pixels, msg.width as number, msg.height as number);
      const inputName = session.inputNames[0];
      const results = await session.run({ [inputName]: inputTensor });
      const outputName = session.outputNames[0];
      const text = ctcDecode(results[outputName]);
      self.postMessage({ type: 'result', id: msg.id, text });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ocr worker] error:`, err);
    if (msg.type === 'recognize') {
      self.postMessage({ type: 'error', id: msg.id, message });
    } else {
      self.postMessage({ type: 'error', message });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  taskQueue = taskQueue.then(() => handleMessage(e.data));
};
