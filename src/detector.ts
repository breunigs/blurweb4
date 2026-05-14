/**
 * YOLOv5 object detection using onnxruntime-web.
 *
 * - ONNX session created once, reused (WebGPU → WebGL → WASM).
 * - Results cached in IndexedDB (persists browser restarts) + in-memory Map.
 * - Only one inference runs at a time; a queue of size 1 holds the next request.
 *   In-flight inference always runs to completion (ensures the result gets cached).
 * - Running inference statistics (count, totalMs) persist in IDB.
 */

import * as ort from 'onnxruntime-web';

// ── Config ────────────────────────────────────────────────────────────────────

export const MODEL_NAME = 'detect_n_2024_04';
const MODEL_PATH = '/models/detect_n_2024_04.onnx';
const MODEL_W = 1280;
const MODEL_H = 736;
const LABELS = ['plate', 'person'] as const;
const THRESHOLD_IOU   = 0.45;
const THRESHOLD_CONF  = 0.1;
const THRESHOLD_CLASS = 0.1;

ort.env.wasm.wasmPaths = '/dist/ort/';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Detection {
  label: 'plate' | 'person';
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snapshot {
  data: Uint8ClampedArray;
  origW: number;
  origH: number;
}

interface PendingItem {
  snap: Snapshot;
  key: string;
  callback: (d: Detection[]) => void;
}

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Key for a still image: MODEL|filename|size|WxH|img */
export function makeImageKey(file: File, width: number, height: number): string {
  return `${MODEL_NAME}|${file.name}|${file.size}|${width}x${height}|img`;
}

/** Key for a video frame: MODEL|filename|size|WxH|t{microseconds} */
export function makeVideoKey(file: File, width: number, height: number, microsecondTimestamp: number): string {
  return `${MODEL_NAME}|${file.name}|${file.size}|${width}x${height}|t${Math.round(microsecondTimestamp)}`;
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'blurweb4-detections';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('frames')) {
        db.createObjectStore('frames', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('stats')) {
        db.createObjectStore('stats', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPut(storeName: string, value: unknown): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

// ── Statistics (persistent) ───────────────────────────────────────────────────

let inferenceCount = 0;
let totalInferenceMs = 0;

// Load persisted stats from IDB at startup (non-blocking).
(async () => {
  try {
    const rec = await idbGet<{ id: string; count: number; totalMs: number }>('stats', 'inference');
    if (rec) {
      inferenceCount   = rec.count;
      totalInferenceMs = rec.totalMs;
      console.log(`[detector] loaded stats: count=${rec.count} avg=${(rec.totalMs / rec.count).toFixed(0)}ms`);
    }
  } catch { /* IDB not available */ }
})();

function persistStats(): void {
  idbPut('stats', { id: 'inference', count: inferenceCount, totalMs: totalInferenceMs }).catch(() => {});
}

/** Returns the running average inference time in ms, or null if no data yet. */
export function getAverageInferenceMs(): number | null {
  return inferenceCount > 0 ? totalInferenceMs / inferenceCount : null;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const memCache = new Map<string, Detection[]>();

// ── Session singleton ─────────────────────────────────────────────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const eps: string[] = [];
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
          const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
          if (adapter) eps.push('webgpu');
        } catch { /* skip */ }
      }
      try {
        const canvas = document.createElement('canvas');
        if (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) eps.push('webgl');
      } catch { /* skip */ }
      eps.push('wasm');
      console.log('[detector] execution providers:', eps);
      for (let i = 0; i < eps.length; i++) {
        const subset = eps.slice(i);
        try {
          const session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: subset });
          console.log(`[detector] session created with EPs: ${subset.join(', ')}`);
          return session;
        } catch (err) {
          if (i < eps.length - 1) console.warn(`[detector] EP "${eps[i]}" failed, trying next:`, err);
          else throw err;
        }
      }
      throw new Error('No working execution provider found');
    })();
  }
  return sessionPromise;
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

/** Capture a snapshot of the source canvas at MODEL_W×MODEL_H resolution. Synchronous. */
function captureSnapshot(source: HTMLCanvasElement | OffscreenCanvas): Snapshot {
  const tmp = new OffscreenCanvas(MODEL_W, MODEL_H);
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, MODEL_W, MODEL_H);
  return {
    data:  ctx.getImageData(0, 0, MODEL_W, MODEL_H).data,
    origW: source.width,
    origH: source.height,
  };
}

function buildTensor(snap: Snapshot): ort.Tensor {
  const { data } = snap;
  const pixels = MODEL_W * MODEL_H;
  const tensor = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    tensor[i]             = data[i * 4]     / 255; // R
    tensor[pixels + i]     = data[i * 4 + 1] / 255; // G
    tensor[pixels * 2 + i] = data[i * 4 + 2] / 255; // B
  }
  return new ort.Tensor('float32', tensor, [1, 3, MODEL_H, MODEL_W]);
}

// ── Postprocessing & NMS ──────────────────────────────────────────────────────

interface RawBox {
  label: 'plate' | 'person';
  conf: number;
  cx: number; cy: number; w: number; h: number;
}

function iou(a: RawBox, b: RawBox): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2;
  const ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2;
  const bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function postprocess(output: ort.Tensor, origW: number, origH: number): Detection[] {
  const data = output.data as Float32Array;
  const [, rows, cols] = output.dims as [number, number, number];
  const raw: RawBox[] = [];
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const objConf    = data[base + 4];
    const plateConf  = data[base + 5];
    const personConf = data[base + 6];
    const classConf  = Math.max(plateConf, personConf);
    if (objConf < THRESHOLD_CONF || classConf < THRESHOLD_CLASS) continue;
    raw.push({
      label: plateConf >= personConf ? LABELS[0] : LABELS[1],
      conf: objConf * classConf,
      cx: data[base], cy: data[base + 1], w: data[base + 2], h: data[base + 3],
    });
  }
  raw.sort((a, b) => b.conf - a.conf);
  const kept: RawBox[] = [];
  const suppressed = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (suppressed[i]) continue;
    kept.push(raw[i]);
    for (let j = i + 1; j < raw.length; j++) {
      if (!suppressed[j] && iou(raw[i], raw[j]) > THRESHOLD_IOU) suppressed[j] = 1;
    }
  }
  const scaleX = origW / MODEL_W, scaleY = origH / MODEL_H;
  return kept.map(b => ({
    label: b.label, conf: b.conf,
    x: Math.round((b.cx - b.w / 2) * scaleX),
    y: Math.round((b.cy - b.h / 2) * scaleY),
    w: Math.round(b.w * scaleX),
    h: Math.round(b.h * scaleY),
  }));
}

// Serialise all ONNX calls — WASM/WebGL runtimes behave poorly with concurrent
// session.run() calls.  Chain every inference on the previous one's Promise so
// at most one inference is in flight at any given time.
let onnxChain: Promise<unknown> = Promise.resolve();

async function runOnnx(snap: Snapshot): Promise<Detection[]> {
  const result = onnxChain.then(async () => {
    const session = await getSession();
    const tensor  = buildTensor(snap);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    return postprocess(results[session.outputNames[0]], snap.origW, snap.origH);
  });
  // Keep the chain alive even if this inference fails.
  onnxChain = result.catch(() => {});
  return result;
}

// ── Cache access ──────────────────────────────────────────────────────────────

/**
 * Returns cached detections for `key`, or null if not cached.
 * Sets `window.__lastDetections` and logs on cache hit.
 */
export async function getCachedDetections(key: string): Promise<Detection[] | null> {
  // 1. Memory cache (fastest)
  const mem = memCache.get(key);
  if (mem !== undefined) {
    console.log(`[detector] cache hit (memory) key="${key}" detections=${mem.length}`);
    (window as unknown as Record<string, unknown>).__lastDetections = mem;
    return mem;
  }

  // 2. IDB
  try {
    const rec = await idbGet<{ key: string; detections: Detection[] }>('frames', key);
    if (rec) {
      memCache.set(key, rec.detections);
      console.log(`[detector] cache hit (IDB) key="${key}" detections=${rec.detections.length}`);
      (window as unknown as Record<string, unknown>).__lastDetections = rec.detections;
      return rec.detections;
    }
  } catch { /* IDB unavailable */ }

  return null;
}

// ── Inference queue ───────────────────────────────────────────────────────────

let queueRunning = false;
let nextPending: PendingItem | null = null;

async function drainQueue(): Promise<void> {
  queueRunning = true;
  while (nextPending) {
    const req = nextPending;
    nextPending = null;
    const t0 = performance.now();
    const detections = await runOnnx(req.snap);
    const ms = performance.now() - t0;
    inferenceCount++;
    totalInferenceMs += ms;
    const avg = totalInferenceMs / inferenceCount;
    console.log(
      `[detector] inference key="${req.key}" ${ms.toFixed(0)}ms` +
      ` detections=${detections.length} avg=${avg.toFixed(0)}ms`,
    );
    memCache.set(req.key, detections);
    idbPut('frames', { key: req.key, detections, cachedAt: Date.now() }).catch(() => {});
    persistStats();
    (window as unknown as Record<string, unknown>).__lastDetections = detections;
    req.callback(detections);
  }
  queueRunning = false;
}

/**
 * Schedule background inference for `source`.
 *
 * - Takes a pixel snapshot of `source` immediately (synchronous) so later draws
 *   on the canvas don't corrupt the queued data.
 * - Replaces any previously queued-but-not-yet-started request.
 * - Any in-flight inference runs to completion before the next one starts.
 */
export function scheduleInference(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
  callback: (d: Detection[]) => void,
): void {
  (window as unknown as Record<string, unknown>).__lastDetections = undefined;
  const snap = captureSnapshot(source);
  nextPending = { snap, key, callback };
  if (!queueRunning) drainQueue().catch(err => console.error('[detector] queue error:', err));
}

// ── Export path ───────────────────────────────────────────────────────────────

/**
 * Run inference for export, bypassing the preview queue.
 * Checks cache first; falls back to direct ONNX inference.
 * Suitable for sequential export where no queue management is needed.
 */
export async function detectForExport(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
): Promise<Detection[]> {
  // Memory cache
  const mem = memCache.get(key);
  if (mem !== undefined) {
    console.log(`[detector] export cache hit (memory) key="${key}" detections=${mem.length}`);
    return mem;
  }

  // IDB cache
  try {
    const rec = await idbGet<{ key: string; detections: Detection[] }>('frames', key);
    if (rec) {
      memCache.set(key, rec.detections);
      console.log(`[detector] export cache hit (IDB) key="${key}" detections=${rec.detections.length}`);
      return rec.detections;
    }
  } catch { /* fall through */ }

  // Live inference
  const t0 = performance.now();
  const snap = captureSnapshot(source);
  const detections = await runOnnx(snap);
  const ms = performance.now() - t0;
  inferenceCount++;
  totalInferenceMs += ms;
  console.log(
    `[detector] export inference key="${key}" ${ms.toFixed(0)}ms` +
    ` detections=${detections.length} avg=${(totalInferenceMs / inferenceCount).toFixed(0)}ms`,
  );
  memCache.set(key, detections);
  idbPut('frames', { key, detections, cachedAt: Date.now() }).catch(() => {});
  persistStats();
  return detections;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Draw detection boxes with label+confidence onto a canvas context. */
export function drawDetections(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  detections: Detection[],
): void {
  if (detections.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;
  ctx.font = '14px monospace';
  for (const d of detections) {
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    const label = `${d.label} ${d.conf.toFixed(2)}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(d.x, d.y - 18, tw + 4, 18);
    ctx.fillStyle = '#ff0000';
    ctx.fillText(label, d.x + 2, d.y - 4);
  }
  ctx.restore();
}
