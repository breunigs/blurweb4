/**
 * YOLOv5 object detection using onnxruntime-web.
 *
 * - ONNX session created once per model choice, reused (WebGPU → WebGL → WASM).
 * - Results cached in IndexedDB (persists browser restarts) + in-memory Map.
 * - Only one inference runs at a time; a queue of size 1 holds the next request.
 *   In-flight inference always runs to completion (ensures cache is populated).
 * - Running inference statistics (count, totalMs) persist in IDB.
 * - Model selection (detect_n = single file, detect_x = 9 chunks) via setModel().
 */

import * as ort from 'onnxruntime-web';
import { getConfig, type DrawMode, type ModelChoice } from './config';
import { blurrer } from './blurrer';

// ── Config ────────────────────────────────────────────────────────────────────

const MODEL_W = 1280;
const MODEL_H = 1280;
const LABELS = ['plate', 'person'] as const;
const THRESHOLD_IOU = 0.45;
// also update confidence slider's minimum value if you changes this
const THRESHOLD_CONF = 0.01;
// Cap candidates per class fed into NMS to bound O(n²) cost.
// With THRESHOLD_CONF=0.01 tens of thousands of boxes can pass the filter;
// NMS on 10 k boxes is ~100 M iterations and will freeze the main thread.
// After sorting by confidence (descending), we keep only the top K — the
// highest-confidence detections are always preferred by greedy NMS anyway.
const MAX_NMS_CANDIDATES_PER_CLASS = 1500;

const MODEL_NAMES: Record<ModelChoice, string> = {
  detect_n: 'detect_n_2024_04',
  detect_x: 'detect_x_2024_04',
};
const DETECT_X_CHUNKS = 9;

ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;

// ── Debug flag ────────────────────────────────────────────────────────────────
// Enable from the browser console:  window.__detectDebug = true
// Then open a file to trigger inference (cache must be cold — clear IDB first).

(window as unknown as Record<string, unknown>).__detectDebug = false;
function dbg(): boolean {
  return !!(window as unknown as Record<string, unknown>).__detectDebug;
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentModel: ModelChoice = getConfig().model;
let currentEP: string | null = null;

/** Human-readable model identifier (used in cache keys). */
export function getModelName(): string {
  return MODEL_NAMES[currentModel];
}

/** Execution provider used by the active session, or null if not yet loaded. */
export function getCurrentEP(): string | null {
  return currentEP;
}

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
  scale: number; // uniform scale applied to fit content into MODEL_W×MODEL_H
  padX: number; // horizontal padding added on each side (letterbox)
  padY: number; // vertical padding added on each side (letterbox)
}

interface PendingItem {
  // Store source reference rather than an eager snapshot so that captureSnapshot
  // (which blocks the main thread for ~130 ms on 4K sources) runs inside drainQueue
  // after a yield, not synchronously on the hot seek-completion path.
  source: HTMLCanvasElement | OffscreenCanvas;
  key: string;
  callback: (d: Detection[]) => void;
  onError?: (err: Error) => void;
}

// ── Cache keys ────────────────────────────────────────────────────────────────

export function makeImageKey(file: File, width: number, height: number): string {
  return `${getModelName()}|${file.name}|${file.size}|${width}x${height}|img`;
}

export function makeVideoKey(file: File, width: number, height: number, microsecondTimestamp: number): string {
  return `${getModelName()}|${file.name}|${file.size}|${width}x${height}|t${Math.round(microsecondTimestamp)}`;
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME = 'blurweb4-detections';
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('trims')) db.createObjectStore('trims', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(store: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// ── Statistics (per-model) ────────────────────────────────────────────────────

type ModelStats = { count: number; totalMs: number };
const inferenceStats: Record<ModelChoice, ModelStats> = {
  detect_n: { count: 0, totalMs: 0 },
  detect_x: { count: 0, totalMs: 0 },
};

// Load persisted stats from IDB at startup.
(async () => {
  for (const model of ['detect_n', 'detect_x'] as ModelChoice[]) {
    try {
      const rec = await idbGet<{ id: string; count: number; totalMs: number }>('stats', `inference-${model}`);
      if (rec) {
        inferenceStats[model].count = rec.count;
        inferenceStats[model].totalMs = rec.totalMs;
      }
    } catch {
      /* ok */
    }
  }
})();

function persistStats(model: ModelChoice): void {
  const s = inferenceStats[model];
  idbPut('stats', { id: `inference-${model}`, count: s.count, totalMs: s.totalMs }).catch(() => {});
}

export function getAverageInferenceMs(model?: ModelChoice): number | null {
  const s = inferenceStats[model ?? currentModel];
  return s.count > 0 ? s.totalMs / s.count : null;
}

export interface InferenceModelStats {
  count: number;
  totalMs: number;
  avgMs: number | null;
}
export function getInferenceStats(): Record<ModelChoice, InferenceModelStats> {
  return {
    detect_n: {
      ...inferenceStats.detect_n,
      avgMs: inferenceStats.detect_n.count > 0 ? inferenceStats.detect_n.totalMs / inferenceStats.detect_n.count : null,
    },
    detect_x: {
      ...inferenceStats.detect_x,
      avgMs: inferenceStats.detect_x.count > 0 ? inferenceStats.detect_x.totalMs / inferenceStats.detect_x.count : null,
    },
  };
}

// Expose for Playwright tests.
(window as unknown as Record<string, unknown>).__getInferenceStats = getInferenceStats;
(window as unknown as Record<string, unknown>).__makeVideoKey = makeVideoKey;

// ── In-memory cache ───────────────────────────────────────────────────────────

const memCache = new Map<string, Detection[]>();

// ── Trim persistence ──────────────────────────────────────────────────────────

export function saveTrim(fileKey: string, start: number, end: number): void {
  idbPut('trims', { key: fileKey, start, end }).catch(() => {});
}

export async function loadTrim(fileKey: string): Promise<{ start: number; end: number } | null> {
  try {
    const rec = await idbGet<{ key: string; start: number; end: number }>('trims', fileKey);
    return rec ? { start: rec.start, end: rec.end } : null;
  } catch {
    return null;
  }
}

/** Filter detections by a minimum combined confidence score. */
export function filterByConf(dets: Detection[], minConf: number): Detection[] {
  return minConf <= 0 ? dets : dets.filter((d) => d.conf >= minConf);
}

/** Clear the in-memory cache and all cached detections from IndexedDB. */
export function clearDetectionCache(): Promise<void> {
  memCache.clear();
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('frames', 'readwrite');
        tx.objectStore('frames').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// ── Session singleton ─────────────────────────────────────────────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null;

// Resolved once at first session creation and reused for all subsequent sessions.
// Re-requesting the adapter/device on each model switch causes the second call to
// silently fail (the adapter becomes lost after the first session is destroyed),
// which drops WebGPU and falls back to WASM even when it was working before.
let resolvedEps: string[] | null = null;

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

async function loadModelBuffer(
  model: ModelChoice,
  onProgress?: (done: number, total: number) => void,
): Promise<string | ArrayBuffer> {
  if (model === 'detect_n') {
    return new URL('../models/detect_n_2024_04.onnx', import.meta.url).href;
  }
  // Fetch detect_x chunks with a concurrency limit of 2 to avoid saturating the
  // connection and triggering browser-side throttling on large parallel fetches.
  // Chunks are stored by index so Blob concatenation order is always correct.
  const CHUNK_CONCURRENCY = 2;
  const blobs: (Blob | null)[] = new Array(DETECT_X_CHUNKS).fill(null);
  let nextChunk = 0;
  let done = 0;
  const t0 = performance.now();

  async function fetchWorker(): Promise<void> {
    while (nextChunk < DETECT_X_CHUNKS) {
      const i = nextChunk++;
      const url = new URL(`../models/detect_x_2024_04.onnx.${i}`, import.meta.url).href;
      const tChunk = performance.now();
      console.log(`[detector] chunk ${i} fetch start`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch model chunk ${i}: ${resp.status}`);
      const blob = await resp.blob();
      console.log(
        `[detector] chunk ${i} done ${(performance.now() - tChunk).toFixed(0)}ms ${(blob.size / 1024).toFixed(0)} KB`,
      );
      blobs[i] = blob;
      onProgress?.(++done, DETECT_X_CHUNKS);
    }
  }

  await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, fetchWorker));
  console.log(`[detector] all chunks fetched ${(performance.now() - t0).toFixed(0)}ms`);
  const tBlob = performance.now();
  const buf = await new Blob(blobs as Blob[]).arrayBuffer();
  console.log(
    `[detector] blob concat ${(performance.now() - tBlob).toFixed(0)}ms total=${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`,
  );
  return buf;
}

export function getSession(onProgress?: (done: number, total: number) => void): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const eps = await resolveEps();
      console.log('[detector] execution providers:', eps);
      const modelSrc = await loadModelBuffer(currentModel, onProgress);
      for (let i = 0; i < eps.length; i++) {
        const subset = eps.slice(i);
        try {
          const session = await ort.InferenceSession.create(modelSrc as string, { executionProviders: subset });
          currentEP = subset[0];
          console.log(`[detector] session created (${getModelName()}) EPs: ${subset.join(', ')}`);
          return session;
        } catch (err) {
          if (i < eps.length - 1) console.warn(`[detector] EP "${eps[i]}" failed:`, err);
          else throw err;
        }
      }
      throw new Error('No working execution provider');
    })();
  }
  return sessionPromise;
}

/**
 * Switch to a different model. Clears the current session; the next inference
 * will load the new model. In-memory cache is cleared (IDB entries for the old
 * model stay, keyed by model name, and won't be hit for the new model).
 */
export function setModel(model: ModelChoice, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (model === currentModel && sessionPromise !== null) return Promise.resolve();
  currentModel = model;
  sessionPromise = null;
  memCache.clear();
  // Pre-warm the session so the UI can show progress before the first inference
  return getSession(onProgress).then(() => {});
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

// YOLOv5 letterbox fill colour (matches PyTorch default: 114/255 ≈ 0.447).
const LETTERBOX_FILL = 'rgb(114,114,114)';

function captureSnapshot(source: HTMLCanvasElement | OffscreenCanvas): Snapshot {
  const t0 = performance.now();
  const srcW = source.width,
    srcH = source.height;
  // Uniform scale so content fits inside MODEL_W×MODEL_H without distortion.
  const scale = Math.min(MODEL_W / srcW, MODEL_H / srcH);
  const scaledW = Math.round(srcW * scale),
    scaledH = Math.round(srcH * scale);
  // Use floor to match PyTorch's letterbox convention (left/top gets the smaller half).
  const padX = Math.floor((MODEL_W - scaledW) / 2),
    padY = Math.floor((MODEL_H - scaledH) / 2);
  const tmp = new OffscreenCanvas(MODEL_W, MODEL_H);
  const ctx = tmp.getContext('2d')!;
  ctx.fillStyle = LETTERBOX_FILL;
  ctx.fillRect(0, 0, MODEL_W, MODEL_H);
  ctx.drawImage(source as CanvasImageSource, padX, padY, scaledW, scaledH);
  const data = ctx.getImageData(0, 0, MODEL_W, MODEL_H).data;
  console.log(`[detector] captureSnapshot ${(performance.now() - t0).toFixed(1)}ms`);
  if (dbg()) {
    console.log(
      `[detector][debug] letterbox: source=${srcW}×${srcH} → scale=${scale.toFixed(4)} scaled=${scaledW}×${scaledH}`,
      `\n  padX=${padX.toFixed(1)} padY=${padY.toFixed(1)} fill=${LETTERBOX_FILL}`,
    );
  }
  return { data, origW: srcW, origH: srcH, scale, padX, padY };
}

function buildTensor(snap: Snapshot): ort.Tensor {
  const t0 = performance.now();
  const { data } = snap;
  const pixels = MODEL_W * MODEL_H;
  const tensor = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[pixels + i] = data[i * 4 + 1] / 255;
    tensor[pixels * 2 + i] = data[i * 4 + 2] / 255;
  }
  console.log(`[detector] buildTensor ${(performance.now() - t0).toFixed(1)}ms`);
  if (dbg()) {
    // Per-channel stats to check for BGR vs RGB issues.
    // If model expects BGR and we feed RGB, channel 0 will have blue-biased stats for a scene
    // that should be red-heavy (and vice versa). Compare against known PyTorch preprocessing.
    let rSum = 0,
      gSum = 0,
      bSum = 0,
      rMin = 1,
      gMin = 1,
      bMin = 1,
      rMax = 0,
      gMax = 0,
      bMax = 0;
    for (let i = 0; i < pixels; i++) {
      const r = tensor[i],
        g = tensor[pixels + i],
        b = tensor[pixels * 2 + i];
      rSum += r;
      gSum += g;
      bSum += b;
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      if (g < gMin) gMin = g;
      if (g > gMax) gMax = g;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
    }
    console.log(
      `[detector][debug] tensor channel stats (channel order sent to model: R G B)`,
      `\n  R: mean=${(rSum / pixels).toFixed(3)} min=${rMin.toFixed(3)} max=${rMax.toFixed(3)}`,
      `\n  G: mean=${(gSum / pixels).toFixed(3)} min=${gMin.toFixed(3)} max=${gMax.toFixed(3)}`,
      `\n  B: mean=${(bSum / pixels).toFixed(3)} min=${bMin.toFixed(3)} max=${bMax.toFixed(3)}`,
      `\n  (if model expects BGR, swap R↔B in buildTensor)`,
    );
  }
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
  const ax1 = a.cx - a.w / 2,
    ay1 = a.cy - a.h / 2,
    ax2 = a.cx + a.w / 2,
    ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2,
    by1 = b.cy - b.h / 2,
    bx2 = b.cx + b.w / 2,
    by2 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy,
    union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function postprocess(output: ort.Tensor, scale: number, padX: number, padY: number): Detection[] {
  const data = output.data as Float32Array;
  const [, rows, cols] = output.dims as [number, number, number];
  console.log(`[detector] starting post-process`);
  if (dbg()) console.log(`[detector][debug] raw output: ${rows} rows × ${cols} cols`);
  let nObjPass = 0,
    nClassPass = 0;

  // Per-class candidate lists (matches PyTorch multi_label=True for nc>1).
  // Each (box, class) pair is emitted independently; NMS is then run per class
  // so a plate and a person can occupy the same region without suppressing each other.
  const rawByClass: RawBox[][] = LABELS.map(() => []);

  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const objConf = data[base + 4];
    if (objConf < THRESHOLD_CONF) continue;
    nObjPass++;
    const cx = data[base], cy = data[base + 1], w = data[base + 2], h = data[base + 3];
    for (let c = 0; c < LABELS.length; c++) {
      const conf = objConf * data[base + 5 + c];
      if (conf < THRESHOLD_CONF) continue;
      nClassPass++;
      rawByClass[c].push({ label: LABELS[c], conf, cx, cy, w, h });
    }
  }

  if (dbg()) {
    console.log(
      `[detector][debug] filtering: total=${rows} objConf≥${THRESHOLD_CONF}→${nObjPass} candidates→${nClassPass}`,
      `\n  THRESHOLD_CONF=${THRESHOLD_CONF} THRESHOLD_IOU=${THRESHOLD_IOU}`,
    );
  }

  const candidateCounts = rawByClass.map((r, i) => `${LABELS[i]}=${r.length}`).join(' ');
  console.log(`[detector] pre-NMS candidates: ${candidateCounts} (total=${nClassPass})`);

  // Per-class greedy NMS (descending confidence).
  const kept: RawBox[] = [];
  for (const classRaw of rawByClass) {
    classRaw.sort((a, b) => b.conf - a.conf);
    // Cap to bound O(n²) NMS cost. With THRESHOLD_CONF=0.01 tens of thousands
    // of boxes can pass the filter; 10 k boxes ≈ 100 M iterations and will
    // freeze the main thread. Top-K by confidence is the standard mitigation.
    if (classRaw.length > MAX_NMS_CANDIDATES_PER_CLASS) {
      console.log(`[detector] capping ${classRaw[0].label} candidates ${classRaw.length} → ${MAX_NMS_CANDIDATES_PER_CLASS}`);
      classRaw.splice(MAX_NMS_CANDIDATES_PER_CLASS);
    }
    if (dbg() && classRaw.length > 0) {
      const label = classRaw[0].label;
      console.log(`[detector][debug] top-${Math.min(classRaw.length, 10)} ${label} candidates before NMS (model-pixel coords):`);
      for (const b of classRaw.slice(0, 10)) {
        const x1 = (b.cx - b.w / 2).toFixed(1), y1 = (b.cy - b.h / 2).toFixed(1);
        console.log(
          `  ${b.label} conf=${b.conf.toFixed(3)} cx=${b.cx.toFixed(1)} cy=${b.cy.toFixed(1)} w=${b.w.toFixed(1)} h=${b.h.toFixed(1)}  →  x1=${x1} y1=${y1}`,
        );
      }
    }
    const sup = new Uint8Array(classRaw.length);
    for (let i = 0; i < classRaw.length; i++) {
      if (sup[i]) continue;
      kept.push(classRaw[i]);
      for (let j = i + 1; j < classRaw.length; j++) if (!sup[j] && iou(classRaw[i], classRaw[j]) > THRESHOLD_IOU) sup[j] = 1;
    }
  }

  console.log(`[detector] post-process complete (kept=${kept.length})`);

  if (dbg()) console.log(`[detector][debug] after NMS: ${nClassPass} → ${kept.length} detections`);
  if (dbg())
    console.log(`[detector][debug] unmap: scale=${scale.toFixed(4)} padX=${padX} padY=${padY}`);
  return kept.map((b) => ({
    label: b.label,
    conf: b.conf,
    x: Math.round((b.cx - b.w / 2 - padX) / scale),
    y: Math.round((b.cy - b.h / 2 - padY) / scale),
    w: Math.round(b.w / scale),
    h: Math.round(b.h / scale),
  }));
}

// ── Serialised ONNX execution ─────────────────────────────────────────────────

let onnxChain: Promise<unknown> = Promise.resolve();

async function runOnnx(snap: Snapshot): Promise<Detection[]> {
  const result = onnxChain.then(async () => {
    const t0 = performance.now();
    const session = await getSession();
    const tensor = buildTensor(snap);
    const tRun = performance.now();
    const results = await session.run({ [session.inputNames[0]]: tensor });
    console.log(`[detector] session.run ${(performance.now() - tRun).toFixed(1)}ms (ep=${currentEP})`);
    const detections = postprocess(results[session.outputNames[0]], snap.scale, snap.padX, snap.padY);
    console.log(`[detector] runOnnx total ${(performance.now() - t0).toFixed(1)}ms`);
    return detections;
  });
  onnxChain = result.catch(() => {});
  return result;
}

// ── Cache access ──────────────────────────────────────────────────────────────

export async function getCachedDetections(key: string): Promise<Detection[] | null> {
  const mem = memCache.get(key);
  if (mem !== undefined) {
    console.log(`[detector] cache hit (memory) key="${key}" detections=${mem.length}`);
    (window as unknown as Record<string, unknown>).__lastDetections = mem;
    return mem;
  }
  try {
    const rec = await idbGet<{ key: string; detections: Detection[] }>('frames', key);
    if (rec) {
      memCache.set(key, rec.detections);
      console.log(`[detector] cache hit (IDB) key="${key}" detections=${rec.detections.length}`);
      (window as unknown as Record<string, unknown>).__lastDetections = rec.detections;
      return rec.detections;
    }
  } catch {
    /* ok */
  }
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

    // Yield the main thread so slider/pointer events can process before we spend
    // ~130 ms in captureSnapshot.  If a newer inference was scheduled during the
    // yield, nextPending will be non-null → skip this (now stale) request.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (nextPending !== null) continue;

    console.log(`[detector] drainQueue: starting inference key="${req.key}"`);
    const snap = captureSnapshot(req.source);
    const t0 = performance.now();
    let detections: Detection[];
    try {
      detections = await runOnnx(snap);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[detector] inference failed key="${req.key}":`, error);
      req.onError?.(error);
      continue;
    }
    const ms = performance.now() - t0;
    inferenceStats[currentModel].count++;
    inferenceStats[currentModel].totalMs += ms;
    const avg = inferenceStats[currentModel].totalMs / inferenceStats[currentModel].count;
    console.log(
      `[detector] inference model=${currentModel} key="${req.key}" ${ms.toFixed(0)}ms detections=${detections.length} avg=${avg.toFixed(0)}ms`,
    );
    const tIdb = performance.now();
    memCache.set(req.key, detections);
    idbPut('frames', { key: req.key, detections, cachedAt: Date.now() })
      .then(() => console.log(`[detector] idbPut ${(performance.now() - tIdb).toFixed(1)}ms`))
      .catch(() => {});
    persistStats(currentModel);
    (window as unknown as Record<string, unknown>).__lastDetections = detections;
    req.callback(detections);
  }
  queueRunning = false;
}

export function scheduleInference(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
  callback: (d: Detection[]) => void,
  onError?: (err: Error) => void,
): void {
  (window as unknown as Record<string, unknown>).__lastDetections = undefined;
  const replacing = nextPending !== null;
  // Store source reference only — snapshot is taken lazily inside drainQueue
  // after a main-thread yield, so this call is non-blocking.
  nextPending = { source, key, callback, onError };
  console.log(`[detector] scheduleInference key="${key}" replacing=${replacing} queueRunning=${queueRunning}`);
  if (!queueRunning) drainQueue().catch((err) => console.error('[detector] queue error:', err));
}

// ── Export path ───────────────────────────────────────────────────────────────

export async function detectForExport(source: HTMLCanvasElement | OffscreenCanvas, key: string): Promise<Detection[]> {
  const mem = memCache.get(key);
  if (mem !== undefined) {
    console.log(`[detector] export cache hit (memory) key="${key}" detections=${mem.length}`);
    return mem;
  }
  try {
    const rec = await idbGet<{ key: string; detections: Detection[] }>('frames', key);
    if (rec) {
      memCache.set(key, rec.detections);
      console.log(`[detector] export cache hit (IDB) key="${key}" detections=${rec.detections.length}`);
      return rec.detections;
    }
  } catch {
    /* fall through */
  }
  const t0 = performance.now();
  const detections = await runOnnx(captureSnapshot(source));
  const ms = performance.now() - t0;
  inferenceStats[currentModel].count++;
  inferenceStats[currentModel].totalMs += ms;
  const avg = inferenceStats[currentModel].totalMs / inferenceStats[currentModel].count;
  console.log(
    `[detector] export inference model=${currentModel} key="${key}" ${ms.toFixed(0)}ms detections=${detections.length} avg=${avg.toFixed(0)}ms`,
  );
  memCache.set(key, detections);
  idbPut('frames', { key, detections, cachedAt: Date.now() }).catch(() => {});
  persistStats(currentModel);
  return detections;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawOutline(ctx: AnyCtx, detections: Detection[]): void {
  if (detections.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;
  const fontSize = 28;
  ctx.font = `${fontSize}px monospace`;
  for (const d of detections) {
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    const label = `${d.label} ${d.conf.toFixed(2)}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(d.x, d.y - fontSize, tw + 4, fontSize);
    ctx.fillStyle = '#ff0000';
    ctx.fillText(label, d.x + 2, d.y - 5);
  }
  ctx.restore();
}

/** Apply detections to the canvas using the current draw mode. */
export function applyDetections(ctx: AnyCtx, detections: Detection[], mode: DrawMode): void {
  if (detections.length === 0) return;
  if (mode === 'outline') {
    drawOutline(ctx, detections);
  } else {
    blurrer.apply(ctx, detections, mode);
  }
}
