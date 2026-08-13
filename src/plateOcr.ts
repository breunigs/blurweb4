/**
 * License plate OCR — crops plate regions, sends to OCR worker, caches results.
 *
 * Lazy-loaded: this module (and the OCR ONNX model) is only imported when the
 * user enters a plate string in the "Keep plates" field or focuses it.
 */

import { getFileHash, idbGet, idbPut, postOcrMessage, registerOcrHandler, type Detection } from './detector';
import { LruMap } from './lruMap';

declare const HASH_OCR_REC: string;
declare const HASH_OCR_DET: string;
declare const HASH_OCR_DICT: string;

// ── Debug flag ──────────────────────────────────────────────────────────────
// Enable from the browser console:  window.__ocrDebug = true
// Then open a file (clear IDB cache first) to see det/rec debug output.
// Deskewed plate images are logged as clickable blob URLs in the console.

(window as unknown as Record<string, unknown>).__ocrDebug = false;
function ocrDbg(): boolean {
  return !!(window as unknown as Record<string, unknown>).__ocrDebug;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OcrResult {
  detection: Detection;
  text: string;
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ── Constants ────────────────────────────────────────────────────────────────

const REC_HEIGHT = 48;
const MAX_REC_WIDTH = 320;
/** Minimum plate dimensions to attempt OCR (in source image pixels). */
const MIN_PLATE_WIDTH = 30;
const MIN_PLATE_HEIGHT = 10;

// ── OCR cache (in-memory + IndexedDB) ────────────────────────────────────────

const ocrCache = new LruMap<string, string>(500);

async function ocrCacheGet(key: string): Promise<string | undefined> {
  const mem = ocrCache.get(key);
  if (mem !== undefined) return mem;
  const rec = await idbGet<{ key: string; text: string }>('ocr', key);
  if (rec !== undefined) {
    ocrCache.set(key, rec.text);
    return rec.text;
  }
  return undefined;
}

function ocrCacheSet(key: string, text: string): void {
  ocrCache.set(key, text);
  idbPut('ocr', { key, text }).catch((err) =>
    console.warn('[plateOcr] idbPut ocr failed:', err),
  );
}

/** Build an OCR cache key. Single model, so no model variant in key. */
function makeOcrKey(
  fileHash: string,
  fileSize: number,
  canvasW: number,
  canvasH: number,
  frameRef: string,
  d: Detection,
): string {
  return `ocr|${fileHash}|${fileSize}|${canvasW}x${canvasH}|${frameRef}|${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.w)},${Math.round(d.h)}`;
}

// ── Shared worker lifecycle ──────────────────────────────────────────────────
// OCR now runs inside the same Web Worker as object detection (detector.worker.ts)
// so there is only one ONNX Runtime WASM heap. Messages are routed via
// registerOcrHandler / postOcrMessage from detector.ts.

let ocrReady: Promise<void> | null = null;
let ocrReadyResolve: (() => void) | null = null;
let ocrReadyReject: ((e: Error) => void) | null = null;
let nextId = 0;
const pendingResults = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();

function getModelUrl(): string {
  const u = new URL('../models/ocr/rec.onnx', import.meta.url);
  u.searchParams.set('v', HASH_OCR_REC);
  return u.href;
}

function getDetModelUrl(): string {
  const u = new URL('../models/ocr/det.onnx', import.meta.url);
  u.searchParams.set('v', HASH_OCR_DET);
  return u.href;
}

function getDictUrl(): string {
  const u = new URL('../models/ocr/dict.txt', import.meta.url);
  u.searchParams.set('v', HASH_OCR_DICT);
  return u.href;
}

function handleOcrMessage(msg: Record<string, unknown>): void {
  const type = msg.type as string;
  if (type === 'debug-image') {
    const url = URL.createObjectURL(msg.blob as Blob);
    console.log(`[plateOcr] ${msg.label} — open: ${url}`);
  } else if (type === 'ocr-ready') {
    ocrReadyResolve?.();
    ocrReadyResolve = ocrReadyReject = null;
  } else if (type === 'ocr-result' && msg.id !== undefined) {
    const pending = pendingResults.get(msg.id as number);
    if (pending) {
      pendingResults.delete(msg.id as number);
      pending.resolve((msg.text as string) ?? '');
    }
  } else if (type === 'ocr-released') {
    ocrReady = null;
  } else if (type === 'ocr-error') {
    if (msg.id !== undefined) {
      const pending = pendingResults.get(msg.id as number);
      if (pending) {
        pendingResults.delete(msg.id as number);
        pending.reject(new Error(msg.message as string));
      }
    } else {
      console.error(`[plateOcr] OCR init error: ${msg.message}`);
      ocrReadyReject?.(new Error(msg.message as string));
      ocrReadyResolve = ocrReadyReject = null;
    }
  } else if (type === 'error') {
    // Worker crashed — reject everything
    const err = new Error((msg.message as string) ?? 'worker crashed');
    ocrReadyReject?.(err);
    ocrReadyResolve = ocrReadyReject = null;
    for (const pending of pendingResults.values()) pending.reject(err);
    pendingResults.clear();
    ocrReady = null;
  }
}

// Register handler once at module load.
registerOcrHandler(handleOcrMessage);

function ensureOcr(): Promise<void> {
  if (ocrReady) return ocrReady;
  ocrReady = new Promise<void>((resolve, reject) => {
    ocrReadyResolve = resolve;
    ocrReadyReject = reject;
    postOcrMessage({ type: 'ocr-init', modelUrl: getModelUrl(), dictUrl: getDictUrl(), detModelUrl: getDetModelUrl() });
  });
  ocrReady.catch(() => { ocrReady = null; });
  return ocrReady;
}

// ── Low-memory teardown ─────────────────────────────────────────────────────
// On mobile / low-RAM devices, release OCR sessions after each batch to free
// model memory within the shared WASM heap.
// navigator.deviceMemory is Chrome/Edge only; fall back to maxTouchPoints as
// a mobile heuristic when it's unavailable.

const _lowMemory: boolean = (() => {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined) return mem <= 4;
  return navigator.maxTouchPoints > 0;
})();

/** Release OCR sessions in the shared worker. Re-loaded on next use by ensureOcr(). */
function releaseOcr(): void {
  if (!ocrReady) return;
  console.log('[plateOcr] releasing OCR sessions (low-memory mode)');
  postOcrMessage({ type: 'ocr-release' });
  ocrReady = null;
}

// ── Source dimensions ────────────────────────────────────────────────────────

/** Get source image dimensions. Falls back to canvas dimensions for video files. */
async function getSourceDims(
  file: File,
  canvasW: number,
  canvasH: number,
): Promise<{ sourceW: number; sourceH: number }> {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file);
    const sourceW = bitmap.width;
    const sourceH = bitmap.height;
    bitmap.close();
    return { sourceW, sourceH };
  }
  // Video files: canvas already has the frame at display resolution
  return { sourceW: canvasW, sourceH: canvasH };
}

// ── Plate cropping ───────────────────────────────────────────────────────────

/** Reusable OffscreenCanvas for resizing plate crops to 48×W. */
let _cropCanvas: OffscreenCanvas | null = null;

/**
 * Crop a plate region and resize to 48×W for OCR.
 *
 * If the plate box is too small on the preview canvas, `sourceFile` is used
 * to extract from the full-resolution source image instead.
 */
function cropPlateFromCtx(
  ctx: AnyCtx,
  d: Detection,
): { pixels: ArrayBuffer; width: number; height: number } | null {
  const canvasW = (ctx as CanvasRenderingContext2D).canvas.width;
  const canvasH = (ctx as CanvasRenderingContext2D).canvas.height;
  // Clamp coordinates to canvas bounds
  const sx = Math.max(0, Math.round(d.x));
  const sy = Math.max(0, Math.round(d.y));
  const sw = Math.min(Math.round(d.w), canvasW - sx);
  const sh = Math.min(Math.round(d.h), canvasH - sy);
  if (sw <= 0 || sh <= 0) return null;

  // Resize to fixed height, proportional width (capped)
  const targetW = Math.min(MAX_REC_WIDTH, Math.round(sw * REC_HEIGHT / sh));
  const targetH = REC_HEIGHT;

  if (!_cropCanvas || _cropCanvas.width !== targetW || _cropCanvas.height !== targetH) {
    _cropCanvas = new OffscreenCanvas(targetW, targetH);
  }
  const cropCtx = _cropCanvas.getContext('2d')!;
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';

  // Draw the plate region scaled to target size
  const srcData = ctx.getImageData(sx, sy, sw, sh);
  const tempCanvas = new OffscreenCanvas(sw, sh);
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(srcData, 0, 0);

  cropCtx.drawImage(tempCanvas, 0, 0, sw, sh, 0, 0, targetW, targetH);
  const resizedData = cropCtx.getImageData(0, 0, targetW, targetH);

  return { pixels: resizedData.data.buffer, width: targetW, height: targetH };
}

/**
 * Crop a plate region from the full-resolution source image.
 * Used when the preview canvas is scaled down and the plate is too small there.
 */
async function cropPlateFromSource(
  sourceFile: File,
  d: Detection,
  canvasW: number,
  canvasH: number,
): Promise<{ pixels: ArrayBuffer; width: number; height: number } | null> {
  // Create a bitmap of the source file
  const bitmap = await createImageBitmap(sourceFile);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // Scale detection coords from preview canvas to source dimensions
  const scaleX = srcW / canvasW;
  const scaleY = srcH / canvasH;
  const sx = Math.max(0, Math.round(d.x * scaleX));
  const sy = Math.max(0, Math.round(d.y * scaleY));
  const sw = Math.min(Math.round(d.w * scaleX), srcW - sx);
  const sh = Math.min(Math.round(d.h * scaleY), srcH - sy);
  if (sw <= 0 || sh <= 0) { bitmap.close(); return null; }

  // Extract the plate region from source at full resolution
  const plateCanvas = new OffscreenCanvas(sw, sh);
  const plateCtx = plateCanvas.getContext('2d')!;
  plateCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  // Resize to fixed height for OCR
  const targetW = Math.min(MAX_REC_WIDTH, Math.round(sw * REC_HEIGHT / sh));
  const targetH = REC_HEIGHT;

  if (!_cropCanvas || _cropCanvas.width !== targetW || _cropCanvas.height !== targetH) {
    _cropCanvas = new OffscreenCanvas(targetW, targetH);
  }
  const cropCtx = _cropCanvas.getContext('2d')!;
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';
  cropCtx.drawImage(plateCanvas, 0, 0, sw, sh, 0, 0, targetW, targetH);
  const resizedData = cropCtx.getImageData(0, 0, targetW, targetH);

  return { pixels: resizedData.data.buffer, width: targetW, height: targetH };
}

// ── Raw crop extraction (for det + rec pipeline) ────────────────────────────

/** Extract plate region at canvas resolution (no resize to 48×W). */
function extractRawCrop(
  ctx: AnyCtx,
  d: Detection,
): { pixels: ArrayBuffer; width: number; height: number } | null {
  const canvasW = (ctx as CanvasRenderingContext2D).canvas.width;
  const canvasH = (ctx as CanvasRenderingContext2D).canvas.height;
  const sx = Math.max(0, Math.round(d.x));
  const sy = Math.max(0, Math.round(d.y));
  const sw = Math.min(Math.round(d.w), canvasW - sx);
  const sh = Math.min(Math.round(d.h), canvasH - sy);
  if (sw <= 0 || sh <= 0) return null;
  const data = ctx.getImageData(sx, sy, sw, sh);
  return { pixels: data.data.buffer, width: sw, height: sh };
}

/** Extract plate region from full-resolution source image (no resize). */
async function extractRawCropFromSource(
  sourceFile: File,
  d: Detection,
  canvasW: number,
  canvasH: number,
): Promise<{ pixels: ArrayBuffer; width: number; height: number } | null> {
  const bitmap = await createImageBitmap(sourceFile);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const scaleX = srcW / canvasW;
  const scaleY = srcH / canvasH;
  const sx = Math.max(0, Math.round(d.x * scaleX));
  const sy = Math.max(0, Math.round(d.y * scaleY));
  const sw = Math.min(Math.round(d.w * scaleX), srcW - sx);
  const sh = Math.min(Math.round(d.h * scaleY), srcH - sy);
  if (sw <= 0 || sh <= 0) { bitmap.close(); return null; }
  const plateCanvas = new OffscreenCanvas(sw, sh);
  const plateCtx = plateCanvas.getContext('2d')!;
  plateCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const data = plateCtx.getImageData(0, 0, sw, sh);
  return { pixels: data.data.buffer, width: sw, height: sh };
}

// ── OCR inference ────────────────────────────────────────────────────────────

async function recognizeOne(
  ctx: AnyCtx,
  d: Detection,
  sourceFile: File,
  canvasW: number,
  canvasH: number,
): Promise<string> {
  let crop: { pixels: ArrayBuffer; width: number; height: number } | null = null;

  // For images, prefer full-resolution source (better for det + rec)
  if (sourceFile.type.startsWith('image/')) {
    const { sourceW, sourceH } = await getSourceDims(sourceFile, canvasW, canvasH);
    const srcBoxW = Math.round(d.w * sourceW / canvasW);
    const srcBoxH = Math.round(d.h * sourceH / canvasH);
    if (srcBoxW >= MIN_PLATE_WIDTH && srcBoxH >= MIN_PLATE_HEIGHT) {
      crop = await extractRawCropFromSource(sourceFile, d, canvasW, canvasH);
    }
  }

  // Fall back to canvas crop
  if (!crop) {
    const previewW = Math.round(d.w);
    const previewH = Math.round(d.h);
    if (previewW < MIN_PLATE_WIDTH || previewH < MIN_PLATE_HEIGHT) return '';
    crop = extractRawCrop(ctx, d);
  }

  if (!crop) return '';

  await ensureOcr();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pendingResults.set(id, { resolve, reject });
    postOcrMessage(
      { type: 'ocr-detect-and-recognize', id, pixels: crop!.pixels, width: crop!.width, height: crop!.height, debug: ocrDbg() },
      [crop!.pixels],
    );
  });
}

/**
 * Check if a plate detection passes the minimum size threshold,
 * considering both preview and source dimensions.
 */
function platePassesMinSize(
  d: Detection,
  canvasW: number,
  canvasH: number,
  sourceW: number,
  sourceH: number,
): boolean {
  // Check preview dimensions first (fast path)
  if (d.w >= MIN_PLATE_WIDTH && d.h >= MIN_PLATE_HEIGHT) return true;
  // Check source dimensions (plate may be large enough in the original)
  const sourceBoxW = d.w * sourceW / canvasW;
  const sourceBoxH = d.h * sourceH / canvasH;
  return sourceBoxW >= MIN_PLATE_WIDTH && sourceBoxH >= MIN_PLATE_HEIGHT;
}

/** Clear the in-memory OCR cache (IDB is cleared separately by detector). */
export function clearOcrCache(): void {
  ocrCache.clear();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run OCR on all plate detections meeting minimum size.
 * Returns results sorted by plate area descending (larger area = more confident).
 */
export async function recognizePlates(
  ctx: AnyCtx,
  detections: Detection[],
  file: File,
  frameRef: string,
): Promise<OcrResult[]> {
  const canvasW = (ctx as CanvasRenderingContext2D).canvas.width;
  const canvasH = (ctx as CanvasRenderingContext2D).canvas.height;

  const { sourceW, sourceH } = await getSourceDims(file, canvasW, canvasH);

  const allPlates = detections.filter((d) => d.label === 'plate');
  const plates = allPlates
    .filter((d) => {
      const pass = platePassesMinSize(d, canvasW, canvasH, sourceW, sourceH);
      if (!pass && ocrDbg()) {
        const srcBoxW = Math.round(d.w * sourceW / canvasW);
        const srcBoxH = Math.round(d.h * sourceH / canvasH);
        console.log(`[plateOcr] skip: plate ${Math.round(d.w)}×${Math.round(d.h)} (source ${srcBoxW}×${srcBoxH}) below min ${MIN_PLATE_WIDTH}×${MIN_PLATE_HEIGHT}px`);
      }
      return pass;
    })
    // Sort by area descending — recognize largest plates first
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  if (plates.length === 0) return [];

  const fileHash = await getFileHash(file);

  const results: OcrResult[] = [];
  for (const d of plates) {
    const key = makeOcrKey(fileHash, file.size, canvasW, canvasH, frameRef, d);
    let text = await ocrCacheGet(key);
    if (text === undefined) {
      try {
        text = await recognizeOne(ctx, d, file, canvasW, canvasH);
        ocrCacheSet(key, text);
        console.log(`[plateOcr] recognized: "${text}" key="${key}"`);
      } catch (err) {
        console.warn(`[plateOcr] OCR failed (not cached): ${err instanceof Error ? err.message : err}`);
        continue;
      }
    } else {
      console.log(`[plateOcr] cache hit: "${text}" key="${key}"`);
    }
    if (text.length > 0) {
      results.push({ detection: d, text });
    }
  }

  if (_lowMemory) releaseOcr();
  return results;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Strip non-alphanumeric chars (except wildcard * and ÄÖÜ), uppercase. */
export function normalizePlate(s: string): string {
  return s.replace(/[^A-ZÄÖÜ0-9*]/gi, '').toUpperCase();
}

function boxKey(d: Detection): string {
  return `${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.w)},${Math.round(d.h)}`;
}

/**
 * Test if an OCR result matches any of the user's keep-plate queries.
 * Without wildcards: exact match (after normalization).
 * With `*`: each `*` matches zero or more characters.
 */
export function plateMatches(ocrText: string, queries: string[]): boolean {
  const norm = normalizePlate(ocrText);
  if (norm.length === 0) return false;
  return queries.some((q) => {
    const nq = normalizePlate(q);
    if (nq.length === 0) return false;
    if (nq.includes('*')) {
      // Wildcard: anchor full match with .* for each *
      const pattern = nq.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(norm);
    }
    return norm === nq;
  });
}

/**
 * Filter detections by OCR: remove plates whose recognized text matches keepPlates.
 * Returns the filtered array (plates to blur) and side-channel data for debug display.
 */
export async function filterByOcr(
  ctx: AnyCtx,
  detections: Detection[],
  keepPlates: string[],
  file: File,
  frameRef: string,
): Promise<{ filtered: Detection[]; excludedKeys: Set<string>; ocrTexts: Map<string, string> }> {
  const ocrTexts = new Map<string, string>();
  const excludedKeys = new Set<string>();

  const canvasW = (ctx as CanvasRenderingContext2D).canvas.width;
  const canvasH = (ctx as CanvasRenderingContext2D).canvas.height;

  const { sourceW, sourceH } = await getSourceDims(file, canvasW, canvasH);

  const plates = detections.filter((d) => {
    if (d.label !== 'plate') return false;
    const pass = platePassesMinSize(d, canvasW, canvasH, sourceW, sourceH);
    if (!pass && ocrDbg()) {
      const srcBoxW = Math.round(d.w * sourceW / canvasW);
      const srcBoxH = Math.round(d.h * sourceH / canvasH);
      console.log(`[plateOcr] skip: plate ${Math.round(d.w)}×${Math.round(d.h)} (source ${srcBoxW}×${srcBoxH}) below min ${MIN_PLATE_WIDTH}×${MIN_PLATE_HEIGHT}px`);
    }
    return pass;
  });
  if (plates.length === 0) return { filtered: detections, excludedKeys, ocrTexts };

  const fileHash = await getFileHash(file);

  // Run OCR on all plate detections
  for (const d of plates) {
    const cacheKey = makeOcrKey(fileHash, file.size, canvasW, canvasH, frameRef, d);
    let text = await ocrCacheGet(cacheKey);
    if (text === undefined) {
      try {
        text = await recognizeOne(ctx, d, file, canvasW, canvasH);
        ocrCacheSet(cacheKey, text);
        console.log(`[plateOcr] recognized: "${text}" key="${cacheKey}"`);
      } catch (err) {
        console.warn(`[plateOcr] OCR failed (not cached): ${err instanceof Error ? err.message : err}`);
        continue;
      }
    }
    const bk = boxKey(d);
    if (text.length > 0) {
      ocrTexts.set(bk, text);
      if (plateMatches(text, keepPlates)) {
        excludedKeys.add(bk);
      }
    }
  }

  if (_lowMemory) releaseOcr();

  // Filter out matched plates
  const filtered = detections.filter((d) => !excludedKeys.has(boxKey(d)));
  return { filtered, excludedKeys, ocrTexts };
}

/**
 * Get cached OCR texts for detections without triggering OCR.
 * Used by debug/outline mode to display recognized text if available.
 * Returns undefined if no cached results exist for this context.
 */
export function getLoadedOcrTexts(
  file: File | null,
  fileHash: string | null,
  canvasW: number,
  canvasH: number,
  frameRef: string,
  detections: Detection[],
): Map<string, string> | undefined {
  if (!file || !fileHash) return undefined;
  const plates = detections.filter((d) => d.label === 'plate');
  if (plates.length === 0) return undefined;

  const texts = new Map<string, string>();
  for (const d of plates) {
    const key = makeOcrKey(fileHash, file.size, canvasW, canvasH, frameRef, d);
    const cached = ocrCache.get(key);
    if (cached !== undefined && cached.length > 0) {
      texts.set(boxKey(d), cached);
    }
  }
  return texts.size > 0 ? texts : undefined;
}
