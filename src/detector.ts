/**
 * YOLOv5 object detection using onnxruntime-web.
 *
 * - ONNX session runs in a dedicated Web Worker (detector.worker.ts) to avoid
 *   blocking the main thread during inference. Pixel data is transferred
 *   zero-copy to the worker; detections are posted back.
 * - Results cached in IndexedDB (persists browser restarts) + in-memory Map.
 * - Only one inference runs at a time; a queue of size 1 holds the next request.
 *   In-flight inference always runs to completion (ensures cache is populated).
 * - Running inference statistics (count, totalMs) persist in IDB.
 * - Model selection (detect_n = single file, detect_x = 9 chunks) via setModel().
 */

import { getConfig, type ModelChoice } from './config';
import { idbGet, idbPut, idbClear } from './db';
import { LruMap } from './lruMap';

declare const HASH_DETECTOR_WORKER: string;
declare const HASH_MODEL_N: string;
declare const HASH_MODEL_X: string;

// ── Config ────────────────────────────────────────────────────────────────────

const MODEL_W = 1280;
const MODEL_H = 1280;
const MODEL_NAMES: Record<ModelChoice, string> = {
  detect_n: 'detect_n_2026_08',
  detect_x: 'detect_l_2026_08',
};
const DETECT_X_CHUNKS = 9;

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

// Content fingerprint keyed by File object. We hash the first 8 KB so that two
// files with the same name and size but different content get distinct cache
// keys, while the same file loaded across sessions always hits the IDB cache.
const fileHashes = new WeakMap<File, string>();

export async function getFileHash(file: File): Promise<string> {
  let hash = fileHashes.get(file);
  if (!hash) {
    if (crypto.subtle) {
      const bytes = await file.slice(0, 8192).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).slice(0, 8).join('');
    } else {
      // crypto.subtle is unavailable on non-secure origins (e.g. http://192.x.x.x).
      // Fall back to a fixed placeholder — cache keys will still be scoped by
      // filename + size, so cross-file collisions remain unlikely in practice.
      console.warn('[detector] crypto.subtle unavailable; using placeholder file hash');
      hash = '00000000';
    }
    fileHashes.set(file, hash);
  }
  return hash;
}

export async function makeImageKey(file: File, width: number, height: number): Promise<string> {
  return `${getModelName()}|${await getFileHash(file)}|${file.name}|${file.size}|${width}x${height}|img`;
}

export async function makeVideoKey(file: File, width: number, height: number, microsecondTimestamp: number): Promise<string> {
  return `${getModelName()}|${await getFileHash(file)}|${file.name}|${file.size}|${width}x${height}|t${Math.round(microsecondTimestamp)}`;
}

// ── IndexedDB (shared connection from db.ts) ─────────────────────────────────
// Re-export for consumers that import from detector.ts (e.g. plateOcr.ts)
export { idbGet, idbPut };

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
  idbPut('stats', { id: `inference-${model}`, count: s.count, totalMs: s.totalMs }).catch((err) => {
    console.warn('[detector] idbPut stats failed:', err);
  });
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
// __detectionOverride: set via page.addInitScript() in tests that do not focus on
// inference quality. When non-null, drainQueue() and detectForExport() return this
// array instead of running ONNX (but still write to memCache + IDB so subsequent
// cache lookups work normally).
(window as unknown as Record<string, unknown>).__getInferenceStats = getInferenceStats;
(window as unknown as Record<string, unknown>).__makeVideoKey = makeVideoKey;
(window as unknown as Record<string, unknown>).__clearDetectionCache = clearDetectionCache;

// ── In-memory cache ───────────────────────────────────────────────────────────

const memCache = new LruMap<string, Detection[]>(500);

/** Filter detections by a minimum combined confidence score. */
export function filterByConf(dets: Detection[], minConf: number): Detection[] {
  return minConf <= 0 ? dets : dets.filter((d) => d.conf >= minConf);
}

/** Filter detections to only include enabled label types. */
export function filterByLabel(dets: Detection[], enabledLabels: string[]): Detection[] {
  if (enabledLabels.length === 0) return [];
  const set = new Set(enabledLabels);
  return dets.filter((d) => set.has(d.label));
}

/** Merge ratio: boxes whose smaller area is ≥ this fraction covered merge. */
const THRESHOLD_MERGE = 0.7;

/**
 * Merge same-label boxes that heavily overlap: when the intersection covers
 * ≥ THRESHOLD_MERGE of the smaller box's area, replace both with their
 * bounding union (keeping the higher confidence). Repeats until stable.
 */
function mergeOverlapping(dets: Detection[]): Detection[] {
  const before = dets.length;
  const out = dets.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (out[i].label !== out[j].label) continue;
        const a = out[i], b = out[j];
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const inter = ix * iy;
        const minArea = Math.min(a.w * a.h, b.w * b.h);
        if (minArea <= 0 || inter / minArea < THRESHOLD_MERGE) continue;
        const mx = Math.min(a.x, b.x), my = Math.min(a.y, b.y);
        out[i] = { label: a.label, conf: Math.max(a.conf, b.conf), x: mx, y: my, w: Math.max(a.x + a.w, b.x + b.w) - mx, h: Math.max(a.y + a.h, b.y + b.h) - my };
        out.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  const merged = before - out.length;
  if (merged > 0) console.log(`[detector] merged ${merged} overlapping boxes (${before} → ${out.length})`);
  return out;
}

/** Apply both confidence and label filters from config, then merge overlapping boxes. */
export function applyFilters(dets: Detection[], minConf: number, enabledLabels: string[]): Detection[] {
  return mergeOverlapping(filterByLabel(filterByConf(dets, minConf), enabledLabels));
}

// ── OCR integration ──────────────────────────────────────────────────────────

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OcrFilterResult {
  /** Detections with excluded plates removed (for non-outline rendering). */
  detections: Detection[];
  /** All detections after confidence+label filtering, NOT OCR-excluded (for outline mode). */
  allDetections: Detection[];
  /** Box keys of plates excluded by OCR match. */
  excludedKeys: Set<string>;
  /** All recognized plate texts keyed by box coordinates. */
  ocrTexts: Map<string, string>;
}

// Module-level cached import — resolved once, reused forever.
let _plateOcrModule: typeof import('./plateOcr') | null = null;

async function getPlateOcr() {
  if (!_plateOcrModule) _plateOcrModule = await import('./plateOcr');
  return _plateOcrModule;
}

/** Allow external code to register the plateOcr module once loaded. */
export function registerPlateOcrModule(mod: typeof import('./plateOcr')): void {
  _plateOcrModule = mod;
}

/**
 * Apply confidence + label filters, then optionally run OCR to exclude kept plates.
 * Returns both the filtered array and debug metadata for outline mode.
 */
export async function applyFiltersWithOcr(
  dets: Detection[],
  minConf: number,
  enabledLabels: string[],
  keepPlates: string[],
  ctx: AnyCtx | null,
  file: File | null,
  frameRef: string,
): Promise<OcrFilterResult> {
  const allDetections = applyFilters(dets, minConf, enabledLabels);
  if (!ctx || !file) {
    return { detections: allDetections, allDetections, excludedKeys: new Set(), ocrTexts: new Map() };
  }
  // Run OCR when keep-plates has entries OR when the feature is enabled (for suggestion chips).
  const shouldRunOcr = keepPlates.length > 0 || getConfig().keepPlatesEnabled;
  if (!shouldRunOcr) {
    // Return cached OCR texts for debug/outline display without triggering OCR.
    let ocrTexts = new Map<string, string>();
    if (_plateOcrModule) {
      const canvasW = (ctx as CanvasRenderingContext2D).canvas.width;
      const canvasH = (ctx as CanvasRenderingContext2D).canvas.height;
      const hash = fileHashes.get(file) ?? null;
      ocrTexts = _plateOcrModule.getLoadedOcrTexts(file, hash, canvasW, canvasH, frameRef, allDetections) ?? new Map();
    }
    return { detections: allDetections, allDetections, excludedKeys: new Set(), ocrTexts };
  }
  const mod = await getPlateOcr();
  const { filtered, excludedKeys, ocrTexts } = await mod.filterByOcr(ctx, allDetections, keepPlates, file, frameRef);
  return { detections: filtered, allDetections, excludedKeys, ocrTexts };
}

/** All detection labels the current model family supports. */
export const ALL_LABELS = ['plate', 'person'] as const;

/** Clear the in-memory cache and all cached detections + OCR from IndexedDB. */
export async function clearDetectionCache(): Promise<void> {
  memCache.clear();
  if (_plateOcrModule) _plateOcrModule.clearOcrCache();
  await Promise.all([idbClear('frames'), idbClear('ocr')]);
}

// ── Model loading ─────────────────────────────────────────────────────────────

async function loadModelBuffer(
  model: ModelChoice,
  onProgress?: (done: number, total: number) => void,
): Promise<string | ArrayBuffer> {
  if (model === 'detect_n') {
    const u = new URL('../models/detect_n_2026_08.onnx', import.meta.url);
    u.searchParams.set('v', HASH_MODEL_N);
    return u.href;
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
      const _u = new URL(`../models/detect_l_2026_08.onnx.${i}`, import.meta.url);
      _u.searchParams.set('v', HASH_MODEL_X);
      const url = _u.href;
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

// ── Web Worker lifecycle ───────────────────────────────────────────────────────
//
// All heavy ONNX work (session creation, tensor building, session.run, NMS)
// runs in detector.worker.ts to avoid blocking the main thread. The worker also
// handles OCR inference (same WASM heap) — see postOcrMessage / registerOcrHandler.
//
// The protocol is strictly sequential — onnxChain ensures only one infer message
// is in-flight at a time, so a single resolve/reject pair suffices (same pattern
// as hevcDecoder.ts).

let worker: Worker | null = null;

// Resolve/reject for the in-flight worker-ready handshake (init / changeModel).
let workerReadyResolve: (() => void) | null = null;
let workerReadyReject: ((e: Error) => void) | null = null;

// Resolve/reject for the single in-flight inference request.
let workerInferResolve: ((d: Detection[]) => void) | null = null;
let workerInferReject: ((e: Error) => void) | null = null;

// ── OCR message routing ──────────────────────────────────────────────────────
// plateOcr.ts registers a handler to receive ocr-* messages from the shared worker.

type OcrMsgHandler = (msg: Record<string, unknown>) => void;
let ocrHandler: OcrMsgHandler | null = null;

/** Register a callback for OCR-related messages from the shared worker. */
export function registerOcrHandler(handler: OcrMsgHandler): void {
  ocrHandler = handler;
}

/**
 * Post an OCR message to the shared worker. Creates the worker if it doesn't
 * exist yet (the detection model is loaded lazily on first detection inference).
 */
export function postOcrMessage(msg: Record<string, unknown>, transfers?: Transferable[]): void {
  ensureWorkerExists();
  worker!.postMessage(msg, { transfer: transfers ?? [] });
}

// ── Worker creation & message handling ────────────────────────────────────────

function ensureWorkerExists(): void {
  if (worker) return;
  const workerUrl = new URL('./detectorWorker.js', import.meta.url);
  workerUrl.searchParams.set('v', HASH_DETECTOR_WORKER);
  worker = new Worker(workerUrl, { type: 'module' });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = handleWorkerError;
}

function handleWorkerError(e: ErrorEvent): void {
  // e.message is often empty/undefined for module-level worker failures
  // (script load error, bad import, ORT init crash). Include filename and
  // line so the debug log gives actionable info.
  const detail = e.message || `${e.filename}:${e.lineno}` || 'unknown';
  console.error(`[detector] worker crashed: ${detail}`);
  const err = new Error(`detector worker: ${detail}`);
  (workerReadyReject ?? workerInferReject)?.(err);
  workerReadyResolve = workerReadyReject = workerInferResolve = workerInferReject = null;
  // Notify OCR handler about the crash so it can reject pending requests.
  ocrHandler?.({ type: 'error', message: `worker crashed: ${detail}` });
  // Null the worker so ensureWorkerReady() recreates it on next inference
  // instead of postMessaging to the dead worker (which hangs forever).
  worker?.terminate();
  worker = null;
  workerReady = null;
}

function handleWorkerMessage(e: MessageEvent): void {
  const msg = e.data as { type: string; ep?: string; detections?: Detection[]; message?: string; [k: string]: unknown };
  // Route OCR messages to registered handler
  if (typeof msg.type === 'string' && (msg.type.startsWith('ocr-') || msg.type === 'debug-image')) {
    ocrHandler?.(msg);
    return;
  }
  if (msg.type === 'ready') {
    currentEP = msg.ep ?? null;
    workerReadyResolve?.();
    workerReadyResolve = workerReadyReject = null;
  } else if (msg.type === 'result') {
    workerInferResolve?.(msg.detections!);
    workerInferResolve = workerInferReject = null;
  } else if (msg.type === 'error') {
    console.error(`[detector] worker error: ${msg.message ?? 'unknown'}`);
    const err = new Error(msg.message ?? 'detector worker error');
    if (workerReadyReject) {
      workerReadyReject(err);
      workerReadyResolve = workerReadyReject = null;
    } else {
      workerInferReject?.(err);
      workerInferResolve = workerInferReject = null;
    }
  }
}

function sendToWorker(msgType: 'init' | 'changeModel', modelSrc: string | ArrayBuffer): Promise<void> {
  ensureWorkerExists();
  return new Promise<void>((resolve, reject) => {
    workerReadyResolve = resolve;
    workerReadyReject = reject;
    const transfers = modelSrc instanceof ArrayBuffer ? [modelSrc] : [];
    worker!.postMessage({ type: msgType, modelSrc }, { transfer: transfers });
  });
}

// Resolved once the worker is ready for inference. Set to null to force re-init.
let workerReady: Promise<void> | null = null;

function ensureWorkerReady(): Promise<void> {
  if (workerReady) return workerReady;
  workerReady = (async () => {
    const modelSrc = await loadModelBuffer(currentModel);
    await sendToWorker('init', modelSrc);
  })().catch((err) => {
    workerReady = null;
    throw err;
  });
  return workerReady;
}

// Serialises concurrent setModel() calls so rapid model switches don't race.
// Each call is chained onto the previous one; only the last model wins because
// the guard `model === currentModel && workerReady !== null` short-circuits.
let setModelChain: Promise<void> = Promise.resolve();

/**
 * Switch to a different model. Resets the worker; the next inference
 * will load the new model. In-memory cache is cleared (IDB entries for the old
 * model stay, keyed by model name, and won't be hit for the new model).
 * Concurrent calls are serialised — the last caller's model always wins.
 */
export function setModel(model: ModelChoice, onProgress?: (done: number, total: number) => void): Promise<void> {
  setModelChain = setModelChain.then(async () => {
    if (model === currentModel && workerReady !== null) return;
    const wasInitialized = worker !== null;
    currentModel = model;
    workerReady = null;
    memCache.clear();
    // Pre-warm the worker so the UI can show progress before the first inference.
    workerReady = (async () => {
      const modelSrc = await loadModelBuffer(model, onProgress);
      await sendToWorker(wasInitialized ? 'changeModel' : 'init', modelSrc);
    })().catch((err) => {
      workerReady = null;
      throw err;
    });
    await workerReady;
  });
  return setModelChain;
}

// ── Preprocessing (main thread — needs canvas access) ─────────────────────────

// YOLOv5 letterbox fill colour (matches PyTorch default: 114/255 ≈ 0.447).
const LETTERBOX_FILL = 'rgb(114,114,114)';

// Reused across calls — captureSnapshot runs serially inside onnxChain.
const _snapshotCanvas = new OffscreenCanvas(MODEL_W, MODEL_H);
const _snapshotCtx = _snapshotCanvas.getContext('2d')!;

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
  const ctx = _snapshotCtx;
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

// ── Serialised ONNX execution (offloaded to worker) ──────────────────────────

let onnxChain: Promise<unknown> = Promise.resolve();

async function runOnnx(snap: Snapshot): Promise<Detection[]> {
  const result = onnxChain.then(async () => {
    await ensureWorkerReady();
    return new Promise<Detection[]>((resolve, reject) => {
      workerInferResolve = resolve;
      workerInferReject = reject;
      // Transfer pixel buffer zero-copy to the worker. After transfer, snap.data
      // is detached — this is safe because buildTensor (now in the worker) is
      // the only consumer.
      const pixelBuffer = snap.data.buffer;
      worker!.postMessage(
        { type: 'infer', pixels: pixelBuffer, scale: snap.scale, padX: snap.padX, padY: snap.padY },
        { transfer: [pixelBuffer] },
      );
    });
  });
  onnxChain = result.catch(() => {});
  return result;
}

// ── Cache access ──────────────────────────────────────────────────────────────

export async function getCachedDetections(key: string): Promise<Detection[] | null> {
  const mem = memCache.get(key);
  if (mem !== undefined) {
    console.log(`[detector] cache hit (memory) key="${key}" detections=${mem.length}`);
    return mem;
  }
  try {
    const rec = await idbGet<{ key: string; detections: Detection[] }>('frames', key);
    if (rec) {
      memCache.set(key, rec.detections);
      console.log(`[detector] cache hit (IDB) key="${key}" detections=${rec.detections.length}`);
      return rec.detections;
    }
  } catch {
    /* ok */
  }
  return null;
}

// ── Unified detection resolver ────────────────────────────────────────────────
// memCache → IDB → __detectionOverride → ONNX inference

async function resolveDetections(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
): Promise<Detection[]> {
  // Guard: zero-dimension source would produce NaN scale/padding, run inference
  // on a blank gray image, and poison the IDB cache with empty results.
  if (source.width === 0 || source.height === 0) {
    console.warn(`[detector] skipping inference: source canvas is ${source.width}×${source.height}`);
    return [];
  }

  const cached = await getCachedDetections(key);
  if (cached !== null) return cached;

  const _g = window as unknown as Record<string, unknown>;
  const _detOverride = (_g.__detectionOverride as Detection[] | undefined) ?? null;
  if (_detOverride !== null) {
    console.log(`[detector] override key="${key}" detections=${_detOverride.length}`);
    memCache.set(key, _detOverride);
    idbPut('frames', { key, detections: _detOverride, cachedAt: Date.now() }).catch((err) => {
      console.warn('[detector] idbPut frames failed:', err);
    });
    return _detOverride;
  }

  const t0 = performance.now();
  const detections = await runOnnx(captureSnapshot(source));
  const ms = performance.now() - t0;
  inferenceStats[currentModel].count++;
  inferenceStats[currentModel].totalMs += ms;
  const avg = inferenceStats[currentModel].totalMs / inferenceStats[currentModel].count;
  console.log(
    `[detector] inference model=${currentModel} key="${key}" ${ms.toFixed(0)}ms detections=${detections.length} avg=${avg.toFixed(0)}ms`,
  );
  memCache.set(key, detections);
  idbPut('frames', { key, detections, cachedAt: Date.now() })
    .catch((err) => console.warn('[detector] idbPut frames failed:', err));
  persistStats(currentModel);
  return detections;
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

    console.log(`[detector] drainQueue: resolving key="${req.key}"`);
    let detections: Detection[];
    try {
      detections = await resolveDetections(req.source, req.key);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[detector] inference failed key="${req.key}":`, error);
      req.onError?.(error);
      continue;
    }
    (window as unknown as Record<string, unknown>).__lastInferenceKey = req.key;
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

export function detectForExport(
  source: HTMLCanvasElement | OffscreenCanvas,
  key: string,
): Promise<Detection[]> {
  return resolveDetections(source, key);
}
