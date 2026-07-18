/**
 * License plate OCR — crops plate regions, sends to OCR worker, caches results.
 *
 * Lazy-loaded: this module (and the OCR ONNX model) is only imported when the
 * user enters a plate string in the "Keep plates" field or focuses it.
 */

import { getFileHash, type Detection } from './detector';
import { LruMap } from './lruMap';

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
const MIN_PLATE_WIDTH = 45;
const MIN_PLATE_HEIGHT = 10;

// ── OCR cache ────────────────────────────────────────────────────────────────

const ocrCache = new LruMap<string, string>(500);

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

// ── Worker lifecycle ─────────────────────────────────────────────────────────

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let nextId = 0;
const pendingResults = new Map<number, (text: string) => void>();

function getModelUrl(): string {
  return new URL('../models/ocr/rec.onnx', import.meta.url).href;
}

function getDictUrl(): string {
  return new URL('../models/ocr/dict.txt', import.meta.url).href;
}

function ensureWorker(): Promise<void> {
  if (workerReady) return workerReady;

  worker = new Worker(new URL('./ocrWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; id?: number; text?: string; message?: string };
    if (msg.type === 'ready') {
      workerReadyResolve?.();
      workerReadyResolve = null;
    } else if (msg.type === 'result' && msg.id !== undefined) {
      const resolve = pendingResults.get(msg.id);
      if (resolve) {
        pendingResults.delete(msg.id);
        resolve(msg.text ?? '');
      }
    } else if (msg.type === 'error') {
      console.error(`[plateOcr] worker error: ${msg.message}`);
      workerReadyReject?.(new Error(msg.message));
      workerReadyResolve = workerReadyReject = null;
    }
  };
  worker.onerror = (e) => {
    console.error(`[plateOcr] worker crashed: ${e.message}`);
    workerReadyReject?.(new Error(e.message));
    workerReadyResolve = workerReadyReject = null;
  };

  workerReady = new Promise<void>((resolve, reject) => {
    workerReadyResolve = resolve;
    workerReadyReject = reject;
    worker!.postMessage({ type: 'init', modelUrl: getModelUrl(), dictUrl: getDictUrl() });
  });
  workerReady.catch(() => {
    workerReady = null;
  });
  return workerReady;
}

let workerReadyResolve: (() => void) | null = null;
let workerReadyReject: ((e: Error) => void) | null = null;

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

// ── OCR inference ────────────────────────────────────────────────────────────

async function recognizeOne(
  ctx: AnyCtx,
  d: Detection,
  sourceFile: File,
  canvasW: number,
  canvasH: number,
): Promise<string> {
  // Check if the plate on the preview canvas is large enough for direct extraction
  const previewW = Math.round(d.w);
  const previewH = Math.round(d.h);

  let crop: { pixels: ArrayBuffer; width: number; height: number } | null = null;

  if (previewW >= MIN_PLATE_WIDTH && previewH >= MIN_PLATE_HEIGHT) {
    // Preview has enough pixels — extract directly
    crop = cropPlateFromCtx(ctx, d);
  }

  if (!crop) {
    // Preview plate is too small — try extracting from full-resolution source
    // Map detection coords to source dimensions and check if it meets the threshold
    const bitmap = await createImageBitmap(sourceFile);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    bitmap.close();

    const sourceBoxW = Math.round(d.w * srcW / canvasW);
    const sourceBoxH = Math.round(d.h * srcH / canvasH);
    if (sourceBoxW < MIN_PLATE_WIDTH || sourceBoxH < MIN_PLATE_HEIGHT) return '';

    crop = await cropPlateFromSource(sourceFile, d, canvasW, canvasH);
  }

  if (!crop) return '';

  await ensureWorker();
  const id = nextId++;
  return new Promise<string>((resolve) => {
    pendingResults.set(id, resolve);
    worker!.postMessage(
      { type: 'recognize', id, pixels: crop!.pixels, width: crop!.width, height: crop!.height },
      { transfer: [crop!.pixels] },
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

  // Get source dimensions for min-size check
  const bitmap = await createImageBitmap(file);
  const sourceW = bitmap.width;
  const sourceH = bitmap.height;
  bitmap.close();

  const plates = detections
    .filter((d) => d.label === 'plate' && platePassesMinSize(d, canvasW, canvasH, sourceW, sourceH))
    // Sort by area descending — recognize largest plates first
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  if (plates.length === 0) return [];

  const fileHash = await getFileHash(file);

  const results: OcrResult[] = [];
  for (const d of plates) {
    const key = makeOcrKey(fileHash, file.size, canvasW, canvasH, frameRef, d);
    let text = ocrCache.get(key);
    if (text === undefined) {
      text = await recognizeOne(ctx, d, file, canvasW, canvasH);
      ocrCache.set(key, text);
      console.log(`[plateOcr] recognized: "${text}" key="${key}"`);
    } else {
      console.log(`[plateOcr] cache hit: "${text}" key="${key}"`);
    }
    if (text.length > 0) {
      results.push({ detection: d, text });
    }
  }

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
  if (norm.length < 2) return false;
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

  // Get source dimensions for min-size check
  const bitmap = await createImageBitmap(file);
  const sourceW = bitmap.width;
  const sourceH = bitmap.height;
  bitmap.close();

  const plates = detections.filter((d) =>
    d.label === 'plate' && platePassesMinSize(d, canvasW, canvasH, sourceW, sourceH),
  );
  if (plates.length === 0) return { filtered: detections, excludedKeys, ocrTexts };

  const fileHash = await getFileHash(file);

  // Run OCR on all plate detections
  for (const d of plates) {
    const cacheKey = makeOcrKey(fileHash, file.size, canvasW, canvasH, frameRef, d);
    let text = ocrCache.get(cacheKey);
    if (text === undefined) {
      text = await recognizeOne(ctx, d, file, canvasW, canvasH);
      ocrCache.set(cacheKey, text);
      console.log(`[plateOcr] recognized: "${text}" key="${cacheKey}"`);
    }
    const bk = boxKey(d);
    if (text.length > 0) {
      ocrTexts.set(bk, text);
      if (plateMatches(text, keepPlates)) {
        excludedKeys.add(bk);
      }
    }
  }

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
