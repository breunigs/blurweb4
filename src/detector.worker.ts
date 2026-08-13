/**
 * Web Worker — runs ONNX inference off the main thread.
 *
 * Handles both YOLOv5 object detection AND PaddleOCR plate recognition in a
 * single worker so there is only one ONNX Runtime WASM heap. This prevents
 * iOS Safari from OOM-crashing when both models are active.
 *
 * All messages are serialized via taskQueue — only one session.run() is active
 * at a time (the ONNX WebGPU backend throws when concurrent runs hit the same
 * session).
 *
 * Detection protocol:
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
 * OCR protocol:
 *  Main → Worker  { type:'ocr-init', modelUrl: string, dictUrl: string,
 *                   detModelUrl?: string }
 *  Worker → Main  { type:'ocr-ready' }
 *
 *  Main → Worker  { type:'ocr-detect-and-recognize', id: number,
 *                   pixels: ArrayBuffer (transferred), width, height, debug }
 *  Worker → Main  { type:'ocr-result', id: number, text: string }
 *
 *  Main → Worker  { type:'ocr-release' }
 *  Worker → Main  { type:'ocr-released' }
 *
 *  Worker → Main  { type:'error', message: string }   (detection errors)
 *  Worker → Main  { type:'ocr-error', id?: number, message: string }
 *  Worker → Main  { type:'debug-image', label: string, blob: Blob }
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

// ── Detection constants ────────────────────────────────────────────────────

const MODEL_W = 1280;
const MODEL_H = 1280;
const LABELS = ['plate', 'person'] as const;
const THRESHOLD_IOU = 0.45;
const THRESHOLD_CONF = 0.01;
const MAX_NMS_CANDIDATES_PER_CLASS = 1500;

// ── OCR constants ──────────────────────────────────────────────────────────

const REC_HEIGHT = 48;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const DET_BINARIZE_THRESH = 0.3;
const DET_BOX_THRESH = 0.25;
const DET_MIN_COMPONENT_PX = 20;
const DET_MIN_RECT_SIDE = 3;
const DET_MIN_INPUT_SIDE = 64;
const DET_MAX_INPUT_SIDE = 960;
const DET_SKIP_ANGLE_RAD = 2 * Math.PI / 180;

// ── State ────────────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let resolvedEps: string[] | null = null;

// OCR state
let ocrRecSession: ort.InferenceSession | null = null;
let ocrDetSession: ort.InferenceSession | null = null;
let dictionary: string[] = [];
let blankIdx = 0;

// ── EP probing ──────────────────────────────────────────────────────────────

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

// ── Detection session management ────────────────────────────────────────────

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

// ── OCR session management ──────────────────────────────────────────────────

async function createOcrRecSession(modelUrl: string): Promise<void> {
  if (ocrRecSession) {
    await (ocrRecSession as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    ocrRecSession = null;
  }
  const eps = await resolveEps();
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ocrRecSession = await ort.InferenceSession.create(modelUrl as any, { executionProviders: subset });
      console.log(`[detector worker] OCR rec session created EPs: ${subset.join(', ')}`);
      return;
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[detector worker] OCR rec EP "${eps[i]}" failed:`, err);
      else throw err;
    }
  }
  throw new Error('No working execution provider for OCR rec');
}

async function createOcrDetSession(modelUrl: string): Promise<void> {
  const eps = await resolveEps();
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ocrDetSession = await ort.InferenceSession.create(modelUrl as any, { executionProviders: subset });
      console.log(`[detector worker] OCR det session created EPs: ${subset.join(', ')}`);
      return;
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[detector worker] OCR det EP "${eps[i]}" failed:`, err);
      else console.warn(`[detector worker] OCR det model load failed:`, err);
    }
  }
}

async function loadDictionary(dictUrl: string): Promise<void> {
  const res = await fetch(dictUrl);
  if (!res.ok) throw new Error(`Failed to fetch dictionary: HTTP ${res.status}`);
  const text = await res.text();
  // monkt/paddleocr-onnx dict format: one character per line.
  // PaddleOCR CTC convention: blank token at index 0, characters at indices 1..N.
  dictionary = [''];
  for (const line of text.split('\n')) {
    if (line.length > 0) dictionary.push(line);
  }
  blankIdx = 0;
  console.log(`[detector worker] dictionary loaded: ${dictionary.length - 1} chars, blank=${blankIdx}`);
}

async function releaseOcrSessions(): Promise<void> {
  if (ocrRecSession) {
    await (ocrRecSession as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    ocrRecSession = null;
  }
  if (ocrDetSession) {
    await (ocrDetSession as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    ocrDetSession = null;
  }
  dictionary = [];
  console.log('[detector worker] OCR sessions released');
}

// ── Detection preprocessing ─────────────────────────────────────────────────

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

// ── Detection postprocessing & NMS ──────────────────────────────────────────

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

// ── OCR preprocessing ───────────────────────────────────────────────────────

function ocrBuildTensor(pixels: Uint8ClampedArray, width: number, height: number): ort.Tensor {
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

// ── OCR geometry utilities (DB text detection postprocessing) ───────────────

function cross2d(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Andrew's monotone chain convex hull. Returns vertices in CCW order. */
function convexHull(points: [number, number][]): [number, number][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = sorted.length;
  if (n <= 2) return sorted;
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2d(...lower[lower.length - 2], ...lower[lower.length - 1], ...p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross2d(...upper[upper.length - 2], ...upper[upper.length - 1], ...sorted[i]) <= 0) upper.pop();
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface MinRect {
  cx: number; cy: number;
  w: number; h: number;
  angle: number;
}

/** Find the minimum-area bounding rectangle of a convex hull via rotating calipers. */
function minAreaRect(hull: [number, number][]): MinRect {
  const n = hull.length;
  if (n < 2) {
    const p: [number, number] = [hull[0]?.[0] ?? 0, hull[0]?.[1] ?? 0];
    return { cx: p[0], cy: p[1], w: 0, h: 0, angle: 0 };
  }

  let bestArea = Infinity;
  let bestAngle = 0;
  let bestXMin = 0, bestXMax = 0, bestYMin = 0, bestYMax = 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = hull[j][0] - hull[i][0];
    const ey = hull[j][1] - hull[i][1];
    if (Math.hypot(ex, ey) === 0) continue;

    const angle = Math.atan2(ey, ex);
    const c = Math.cos(-angle), s = Math.sin(-angle);

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const [px, py] of hull) {
      const rx = px * c - py * s;
      const ry = px * s + py * c;
      if (rx < xMin) xMin = rx; if (rx > xMax) xMax = rx;
      if (ry < yMin) yMin = ry; if (ry > yMax) yMax = ry;
    }

    const area = (xMax - xMin) * (yMax - yMin);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
      bestXMin = xMin; bestXMax = xMax;
      bestYMin = yMin; bestYMax = yMax;
    }
  }

  const ca = Math.cos(bestAngle), sa = Math.sin(bestAngle);
  const rcx = (bestXMin + bestXMax) / 2, rcy = (bestYMin + bestYMax) / 2;

  return {
    cx: rcx * ca - rcy * sa,
    cy: rcx * sa + rcy * ca,
    w: bestXMax - bestXMin,
    h: bestYMax - bestYMin,
    angle: bestAngle,
  };
}

/** Mean probability inside the convex hull polygon (scanline fill). */
function boxScore(prob: Float32Array, mapW: number, mapH: number, hull: [number, number][]): number {
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of hull) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const y0 = Math.max(0, Math.floor(yMin));
  const y1 = Math.min(mapH - 1, Math.ceil(yMax));
  const n = hull.length;
  let sum = 0, count = 0;

  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1h, y1h] = hull[i];
      const [x2h, y2h] = hull[(i + 1) % n];
      if ((y1h <= y && y2h > y) || (y2h <= y && y1h > y)) {
        xs.push(x1h + (y - y1h) / (y2h - y1h) * (x2h - x1h));
      }
    }
    xs.sort((a, b) => a - b);
    for (let p = 0; p + 1 < xs.length; p += 2) {
      const xStart = Math.max(0, Math.floor(xs[p]));
      const xEnd = Math.min(mapW - 1, Math.ceil(xs[p + 1]));
      for (let x = xStart; x <= xEnd; x++) {
        sum += prob[y * mapW + x];
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Find connected components in a binary image using flood fill. */
function findComponents(binary: Uint8Array, w: number, h: number): [number, number][][] {
  const visited = new Uint8Array(w * h);
  const result: [number, number][][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (binary[idx] && !visited[idx]) {
        const comp: [number, number][] = [];
        const stack = [x, y];
        visited[idx] = 1;
        while (stack.length > 0) {
          const cy = stack.pop()!;
          const cx = stack.pop()!;
          comp.push([cx, cy]);
          if (cx > 0     && binary[cy * w + cx - 1]      && !visited[cy * w + cx - 1])      { visited[cy * w + cx - 1] = 1;      stack.push(cx - 1, cy); }
          if (cx < w - 1 && binary[cy * w + cx + 1]      && !visited[cy * w + cx + 1])      { visited[cy * w + cx + 1] = 1;      stack.push(cx + 1, cy); }
          if (cy > 0     && binary[(cy - 1) * w + cx]     && !visited[(cy - 1) * w + cx])     { visited[(cy - 1) * w + cx] = 1;     stack.push(cx, cy - 1); }
          if (cy < h - 1 && binary[(cy + 1) * w + cx]     && !visited[(cy + 1) * w + cx])     { visited[(cy + 1) * w + cx] = 1;     stack.push(cx, cy + 1); }
        }
        if (comp.length >= DET_MIN_COMPONENT_PX) result.push(comp);
      }
    }
  }
  return result;
}

// ── OCR text detection pipeline ─────────────────────────────────────────────

interface DetResult {
  angle: number;
  cx: number; cy: number;
  tw: number; th: number;
}

async function runOcrDetection(pixels: Uint8ClampedArray, width: number, height: number, debug: boolean): Promise<DetResult | null> {
  if (!ocrDetSession) {
    if (debug) console.log('[detector worker] ocr det: no det session loaded, skipping');
    return null;
  }

  let scale = 1;
  if (Math.min(width, height) < DET_MIN_INPUT_SIDE) scale = DET_MIN_INPUT_SIDE / Math.min(width, height);
  if (Math.max(width, height) * scale > DET_MAX_INPUT_SIDE) scale = DET_MAX_INPUT_SIDE / Math.max(width, height);
  const sW = Math.round(width * scale);
  const sH = Math.round(height * scale);
  const padW = Math.ceil(sW / 32) * 32;
  const padH = Math.ceil(sH / 32) * 32;

  if (debug) console.log(`[detector worker] ocr det: input ${width}x${height} → scaled ${sW}x${sH} → padded ${padW}x${padH} (scale=${scale.toFixed(3)})`);

  const srcCanvas = new OffscreenCanvas(width, height);
  srcCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), width, height), 0, 0);
  const padCanvas = new OffscreenCanvas(padW, padH);
  const padCtx = padCanvas.getContext('2d')!;
  padCtx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, sW, sH);
  const rgba = padCtx.getImageData(0, 0, padW, padH).data;

  const pc = padH * padW;
  const t = new Float32Array(3 * pc);
  for (let i = 0; i < pc; i++) {
    t[i]          = (rgba[i * 4]     / 255 - DET_MEAN[0]) / DET_STD[0];
    t[pc + i]     = (rgba[i * 4 + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
    t[pc * 2 + i] = (rgba[i * 4 + 2] / 255 - DET_MEAN[2]) / DET_STD[2];
  }

  const t0 = performance.now();
  const inTensor = new ort.Tensor('float32', t, [1, 3, padH, padW]);
  const res = await ocrDetSession.run({ [ocrDetSession.inputNames[0]]: inTensor });
  const prob = res[ocrDetSession.outputNames[0]].data as Float32Array;
  const detMs = performance.now() - t0;

  const bin = new Uint8Array(padW * padH);
  for (let i = 0; i < padW * padH; i++) bin[i] = prob[i] > DET_BINARIZE_THRESH ? 1 : 0;

  const comps = findComponents(bin, padW, padH);
  if (debug) console.log(`[detector worker] ocr det: inference ${detMs.toFixed(0)}ms, ${comps.length} component(s) above ${DET_MIN_COMPONENT_PX}px`);
  if (comps.length === 0) return null;

  let bestResult: DetResult | null = null;
  let bestScore = 0;
  let bestHull: [number, number][] | null = null;
  for (let ci = 0; ci < comps.length; ci++) {
    const comp = comps[ci];
    const hull = convexHull(comp);
    if (hull.length < 3) continue;
    const rect = minAreaRect(hull);
    if (Math.min(rect.w, rect.h) < DET_MIN_RECT_SIDE) {
      if (debug) console.log(`[detector worker] ocr det:   comp[${ci}] ${comp.length}px → rect ${rect.w.toFixed(0)}x${rect.h.toFixed(0)} — too small, skip`);
      continue;
    }
    const score = boxScore(prob, padW, padH, hull);
    if (debug) console.log(`[detector worker] ocr det:   comp[${ci}] ${comp.length}px → rect ${rect.w.toFixed(0)}x${rect.h.toFixed(0)} angle=${(rect.angle * 180 / Math.PI).toFixed(1)}° score=${score.toFixed(3)}`);
    if (score < DET_BOX_THRESH) continue;

    if (score > bestScore) {
      bestScore = score;
      bestHull = hull;
      let tw = rect.w, th = rect.h, ta = rect.angle;
      if (tw < th) { [tw, th] = [th, tw]; ta += Math.PI / 2; }
      while (ta > Math.PI / 2) ta -= Math.PI;
      while (ta < -Math.PI / 2) ta += Math.PI;
      bestResult = { angle: ta, cx: rect.cx / scale, cy: rect.cy / scale, tw: tw / scale, th: th / scale };
    }
  }

  if (debug) {
    if (bestResult) console.log(`[detector worker] ocr det: best → angle=${(bestResult.angle * 180 / Math.PI).toFixed(1)}° score=${bestScore.toFixed(3)}`);
    else console.log(`[detector worker] ocr det: no text region passed filters`);

    if (bestHull) {
      const Z = 4;
      const dbgCanvas = new OffscreenCanvas(width * Z, height * Z);
      const dbgCtx = dbgCanvas.getContext('2d')!;
      dbgCtx.imageSmoothingEnabled = false;
      const srcImg = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), width, height);
      const tmpCanvas = new OffscreenCanvas(width, height);
      tmpCanvas.getContext('2d')!.putImageData(srcImg, 0, 0);
      dbgCtx.drawImage(tmpCanvas, 0, 0, width * Z, height * Z);
      dbgCtx.strokeStyle = '#00ff00';
      dbgCtx.lineWidth = 2;
      dbgCtx.beginPath();
      dbgCtx.moveTo(bestHull[0][0] / scale * Z, bestHull[0][1] / scale * Z);
      for (let i = 1; i < bestHull.length; i++) dbgCtx.lineTo(bestHull[i][0] / scale * Z, bestHull[i][1] / scale * Z);
      dbgCtx.closePath();
      dbgCtx.stroke();
      dbgCanvas.convertToBlob({ type: 'image/png' }).then((blob) => {
        self.postMessage({ type: 'debug-image', label: `det region ${width}x${height} (4x)`, blob });
      }).catch(() => {});
    }
  }
  return bestResult;
}

// ── OCR recognition pipeline ───────────────────────────────────────────────

async function recOnCrop(pixels: Uint8ClampedArray, w: number, h: number): Promise<string> {
  if (!ocrRecSession) throw new Error('OCR rec session not initialized');
  const tgtH = REC_HEIGHT;
  const tgtW = Math.min(320, Math.max(1, Math.round(w * tgtH / h)));
  const srcBitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), w, h));
  const rc = new OffscreenCanvas(tgtW, tgtH);
  const rctx = rc.getContext('2d')!;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(srcBitmap, 0, 0, w, h, 0, 0, tgtW, tgtH);
  srcBitmap.close();
  const resized = rctx.getImageData(0, 0, tgtW, tgtH).data;
  const inputTensor = ocrBuildTensor(resized, tgtW, tgtH);
  const results = await ocrRecSession.run({ [ocrRecSession.inputNames[0]]: inputTensor });
  return ctcDecode(results[ocrRecSession.outputNames[0]]);
}

function rotatePixels(
  pixels: Uint8ClampedArray, w: number, h: number, angle: number,
): { canvas: OffscreenCanvas; w: number; h: number } {
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const rotW = Math.ceil(w * cos + h * sin);
  const rotH = Math.ceil(w * sin + h * cos);
  const srcCanvas = new OffscreenCanvas(w, h);
  srcCanvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), w, h), 0, 0,
  );
  const rotCanvas = new OffscreenCanvas(rotW, rotH);
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate(-angle);
  rotCtx.drawImage(srcCanvas, -w / 2, -h / 2);
  return { canvas: rotCanvas, w: rotW, h: rotH };
}

async function deskewAndRecognize(pixels: Uint8ClampedArray, w: number, h: number, debug: boolean): Promise<string> {
  const det = await runOcrDetection(pixels, w, h, debug);

  if (!det || Math.abs(det.angle) < DET_SKIP_ANGLE_RAD) {
    if (debug) console.log(`[detector worker] deskew: ${det ? `angle ${(det.angle * 180 / Math.PI).toFixed(1)}° below threshold` : 'no det result'} — using original crop ${w}x${h}`);
    const text = await recOnCrop(pixels, w, h);
    if (debug) console.log(`[detector worker] rec: "${text}" (from original ${w}x${h})`);
    return text;
  }

  const angleDeg = (det.angle * 180 / Math.PI).toFixed(1);
  const rot = rotatePixels(pixels, w, h, det.angle);

  const cosA = Math.cos(-det.angle), sinA = Math.sin(-det.angle);
  const rcy = (det.cx - w / 2) * sinA + (det.cy - h / 2) * cosA + rot.h / 2;
  const bandH = Math.round(det.th * 3);
  const cropY = Math.max(0, Math.round(rcy - bandH / 2));
  const finalH = Math.min(bandH, rot.h - cropY);
  const cropped = rot.canvas.getContext('2d')!.getImageData(0, cropY, rot.w, finalH);
  console.log(`[detector worker] deskew: rotate ${angleDeg}° ${w}x${h} → ${rot.w}x${rot.h} → crop ${rot.w}x${finalH}`);

  if (debug) {
    const Z = 4;
    const dbgCanvas = new OffscreenCanvas(rot.w * Z, finalH * Z);
    const dbgCtx = dbgCanvas.getContext('2d')!;
    dbgCtx.imageSmoothingEnabled = false;
    const tmpCanvas = new OffscreenCanvas(rot.w, finalH);
    tmpCanvas.getContext('2d')!.putImageData(cropped, 0, 0);
    dbgCtx.drawImage(tmpCanvas, 0, 0, rot.w * Z, finalH * Z);
    dbgCanvas.convertToBlob({ type: 'image/png' }).then((blob) => {
      self.postMessage({ type: 'debug-image', label: `rotated+crop ${rot.w}x${finalH} (4x)`, blob });
    }).catch(() => {});
  }

  const text = await recOnCrop(cropped.data, rot.w, finalH);
  if (debug) console.log(`[detector worker] rec: "${text}" (from rotated+crop ${rot.w}x${finalH})`);
  return text;
}

// ── CTC decode ──────────────────────────────────────────────────────────────

function ctcDecode(output: ort.Tensor): string {
  const data = output.data as Float32Array;
  const [, seqLen, vocabSize] = output.dims as [number, number, number];
  let prev = -1;
  const chars: string[] = [];
  for (let t = 0; t < seqLen; t++) {
    let maxIdx = 0;
    let maxVal = data[t * vocabSize];
    for (let v = 1; v < vocabSize; v++) {
      const val = data[t * vocabSize + v];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = v;
      }
    }
    if (maxIdx !== blankIdx && maxIdx !== prev) {
      const ch = dictionary[maxIdx] ?? '';
      chars.push(ch);
    }
    prev = maxIdx;
  }
  return chars.filter((c) => /^[A-ZÄÖÜ0-9]$/i.test(c)).join('').toUpperCase();
}

// ── Unified message handler ─────────────────────────────────────────────────

let taskQueue: Promise<void> = Promise.resolve();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(msg: Record<string, any>): Promise<void> {
  try {
    // ── Detection messages ──
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

    // ── OCR messages ──
    } else if (msg.type === 'ocr-init') {
      await loadDictionary(msg.dictUrl as string);
      await createOcrRecSession(msg.modelUrl as string);
      if (msg.detModelUrl) await createOcrDetSession(msg.detModelUrl as string);
      self.postMessage({ type: 'ocr-ready' });
    } else if (msg.type === 'ocr-detect-and-recognize') {
      if (!ocrRecSession) throw new Error('OCR session not initialized');
      const drPixels = new Uint8ClampedArray(msg.pixels as ArrayBuffer);
      const drText = await deskewAndRecognize(drPixels, msg.width as number, msg.height as number, !!msg.debug);
      self.postMessage({ type: 'ocr-result', id: msg.id, text: drText });
    } else if (msg.type === 'ocr-release') {
      await releaseOcrSessions();
      self.postMessage({ type: 'ocr-released' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[detector worker] error:`, err);
    if (msg.type === 'ocr-detect-and-recognize') {
      self.postMessage({ type: 'ocr-error', id: msg.id, message });
    } else if (msg.type === 'ocr-init' || msg.type === 'ocr-release') {
      self.postMessage({ type: 'ocr-error', message });
    } else {
      self.postMessage({ type: 'error', message });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  taskQueue = taskQueue.then(() => handleMessage(e.data));
};
