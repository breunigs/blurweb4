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
const MODEL_H = 736;
const LABELS = ['plate', 'person'] as const;
const THRESHOLD_IOU   = 0.45;
const THRESHOLD_CONF  = 0.1;
const THRESHOLD_CLASS = 0.1;

const MODEL_NAMES: Record<ModelChoice, string> = {
  detect_n: 'detect_n_2024_04',
  detect_x: 'detect_x_2024_04',
};
const DETECT_X_CHUNKS = 9;

ort.env.wasm.wasmPaths = '/dist/ort/';

// ── State ─────────────────────────────────────────────────────────────────────

let currentModel: ModelChoice = getConfig().model;
let currentEP: string | null = null;

/** Human-readable model identifier (used in cache keys). */
export function getModelName(): string { return MODEL_NAMES[currentModel]; }

/** Execution provider used by the active session, or null if not yet loaded. */
export function getCurrentEP(): string | null { return currentEP; }

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

export function makeImageKey(file: File, width: number, height: number): string {
  return `${getModelName()}|${file.name}|${file.size}|${width}x${height}|img`;
}

export function makeVideoKey(file: File, width: number, height: number, microsecondTimestamp: number): string {
  return `${getModelName()}|${file.name}|${file.size}|${width}x${height}|t${Math.round(microsecondTimestamp)}`;
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'blurweb4-detections';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('stats'))  db.createObjectStore('stats',  { keyPath: 'id'  });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPut(store: string, value: unknown): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
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
      if (rec) { inferenceStats[model].count = rec.count; inferenceStats[model].totalMs = rec.totalMs; }
    } catch { /* ok */ }
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

export interface InferenceModelStats { count: number; totalMs: number; avgMs: number | null; }
export function getInferenceStats(): Record<ModelChoice, InferenceModelStats> {
  return {
    detect_n: { ...inferenceStats.detect_n, avgMs: inferenceStats.detect_n.count > 0 ? inferenceStats.detect_n.totalMs / inferenceStats.detect_n.count : null },
    detect_x: { ...inferenceStats.detect_x, avgMs: inferenceStats.detect_x.count > 0 ? inferenceStats.detect_x.totalMs / inferenceStats.detect_x.count : null },
  };
}

// Expose for Playwright tests.
(window as unknown as Record<string, unknown>).__getInferenceStats = getInferenceStats;
(window as unknown as Record<string, unknown>).__makeVideoKey = makeVideoKey;

// ── In-memory cache ───────────────────────────────────────────────────────────

const memCache = new Map<string, Detection[]>();

// ── Session singleton ─────────────────────────────────────────────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function resolveEps(): Promise<string[]> {
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
  return eps;
}

async function loadModelBuffer(
  model: ModelChoice,
  onProgress?: (done: number, total: number) => void,
): Promise<string | ArrayBuffer> {
  if (model === 'detect_n') {
    return `/models/detect_n_2024_04.onnx`;
  }
  // Fetch detect_x chunks and concatenate
  const chunks: ArrayBuffer[] = [];
  for (let i = 0; i < DETECT_X_CHUNKS; i++) {
    const resp = await fetch(`/models/detect_x_2024_04.onnx.${i}`);
    if (!resp.ok) throw new Error(`Failed to fetch model chunk ${i}: ${resp.status}`);
    chunks.push(await resp.arrayBuffer());
    onProgress?.(i + 1, DETECT_X_CHUNKS);
  }
  const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) { out.set(new Uint8Array(c), offset); offset += c.byteLength; }
  return out.buffer;
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
export function setModel(
  model: ModelChoice,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (model === currentModel && sessionPromise !== null) return Promise.resolve();
  currentModel = model;
  sessionPromise = null;
  memCache.clear();
  // Pre-warm the session so the UI can show progress before the first inference
  return getSession(onProgress).then(() => {});
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

function captureSnapshot(source: HTMLCanvasElement | OffscreenCanvas): Snapshot {
  const tmp = new OffscreenCanvas(MODEL_W, MODEL_H);
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, MODEL_W, MODEL_H);
  return { data: ctx.getImageData(0, 0, MODEL_W, MODEL_H).data, origW: source.width, origH: source.height };
}

function buildTensor(snap: Snapshot): ort.Tensor {
  const { data } = snap;
  const pixels = MODEL_W * MODEL_H;
  const tensor = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    tensor[i]             = data[i * 4]     / 255;
    tensor[pixels + i]     = data[i * 4 + 1] / 255;
    tensor[pixels * 2 + i] = data[i * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', tensor, [1, 3, MODEL_H, MODEL_W]);
}

// ── Postprocessing & NMS ──────────────────────────────────────────────────────

interface RawBox { label: 'plate' | 'person'; conf: number; cx: number; cy: number; w: number; h: number; }

function iou(a: RawBox, b: RawBox): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2, ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2, bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy, union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function postprocess(output: ort.Tensor, origW: number, origH: number): Detection[] {
  const data = output.data as Float32Array;
  const [, rows, cols] = output.dims as [number, number, number];
  const raw: RawBox[] = [];
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const objConf = data[base + 4], pc = data[base + 5], nc = data[base + 6];
    if (objConf < THRESHOLD_CONF || Math.max(pc, nc) < THRESHOLD_CLASS) continue;
    raw.push({ label: pc >= nc ? LABELS[0] : LABELS[1], conf: objConf * Math.max(pc, nc),
      cx: data[base], cy: data[base + 1], w: data[base + 2], h: data[base + 3] });
  }
  raw.sort((a, b) => b.conf - a.conf);
  const kept: RawBox[] = [], sup = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (sup[i]) continue;
    kept.push(raw[i]);
    for (let j = i + 1; j < raw.length; j++) if (!sup[j] && iou(raw[i], raw[j]) > THRESHOLD_IOU) sup[j] = 1;
  }
  const sx = origW / MODEL_W, sy = origH / MODEL_H;
  return kept.map(b => ({ label: b.label, conf: b.conf,
    x: Math.round((b.cx - b.w / 2) * sx), y: Math.round((b.cy - b.h / 2) * sy),
    w: Math.round(b.w * sx), h: Math.round(b.h * sy) }));
}

// ── Serialised ONNX execution ─────────────────────────────────────────────────

let onnxChain: Promise<unknown> = Promise.resolve();

async function runOnnx(snap: Snapshot): Promise<Detection[]> {
  const result = onnxChain.then(async () => {
    const session = await getSession();
    const tensor  = buildTensor(snap);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    return postprocess(results[session.outputNames[0]], snap.origW, snap.origH);
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
  } catch { /* ok */ }
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
    inferenceStats[currentModel].count++;
    inferenceStats[currentModel].totalMs += ms;
    const avg = inferenceStats[currentModel].totalMs / inferenceStats[currentModel].count;
    console.log(`[detector] inference model=${currentModel} key="${req.key}" ${ms.toFixed(0)}ms detections=${detections.length} avg=${avg.toFixed(0)}ms`);
    memCache.set(req.key, detections);
    idbPut('frames', { key: req.key, detections, cachedAt: Date.now() }).catch(() => {});
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
): void {
  (window as unknown as Record<string, unknown>).__lastDetections = undefined;
  const snap = captureSnapshot(source);
  nextPending = { snap, key, callback };
  if (!queueRunning) drainQueue().catch(err => console.error('[detector] queue error:', err));
}

// ── Export path ───────────────────────────────────────────────────────────────

export async function detectForExport(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
): Promise<Detection[]> {
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
  } catch { /* fall through */ }
  const t0 = performance.now();
  const detections = await runOnnx(captureSnapshot(source));
  const ms = performance.now() - t0;
  inferenceStats[currentModel].count++;
  inferenceStats[currentModel].totalMs += ms;
  const avg = inferenceStats[currentModel].totalMs / inferenceStats[currentModel].count;
  console.log(`[detector] export inference model=${currentModel} key="${key}" ${ms.toFixed(0)}ms detections=${detections.length} avg=${avg.toFixed(0)}ms`);
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
