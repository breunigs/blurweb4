/**
 * Blur and solid-color rendering for detected regions.
 *
 * Both modes use rounded corners:
 *   plate  → corner radius = min(w,h)/2 × 0.95  (near-ellipse)
 *   person → corner radius = min(w,h)/2 × 0.80
 *
 * Edge clamping: if a detection side is within 0.5 % of the canvas border,
 * the box is extended flush to that border and the adjacent corners become
 * square (radius 0) so no rounded gap appears at the image edge.
 *
 * Blur masks are LRU-cached keyed by shape, position, feather, and snap flags.
 *
 * StackBlur runs in a dedicated Web Worker (blurWorker.ts) to avoid blocking
 * the main thread during inference/export.
 */

import type { Detection } from './detector';

// ── Corner ratios ─────────────────────────────────────────────────────────────

const CORNER_RATIOS: Record<'plate' | 'person', number> = { plate: 0.5, person: 0.8 };

/** Fraction of the canvas dimension within which a box edge is snapped to the border. */
const EDGE_THRESHOLD = 0.005; // 0.5 %

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface CornerRadii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

interface ClippedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  corners: CornerRadii;
  snapL: boolean;
  snapT: boolean;
  snapR: boolean;
  snapB: boolean;
}

// ── Edge clamping ─────────────────────────────────────────────────────────────

function clipToEdges(x: number, y: number, w: number, h: number, r: number, cw: number, ch: number): ClippedBox {
  const thX = cw * EDGE_THRESHOLD;
  const thY = ch * EDGE_THRESHOLD;
  let bx = x,
    by = y,
    bw = w,
    bh = h;
  let snapL = false,
    snapT = false,
    snapR = false,
    snapB = false;

  if (x < thX) {
    bw += bx;
    bx = 0;
    snapL = true;
  }
  if (y < thY) {
    bh += by;
    by = 0;
    snapT = true;
  }
  if (x + w > cw - thX) {
    bw = cw - bx;
    snapR = true;
  }
  if (y + h > ch - thY) {
    bh = ch - by;
    snapB = true;
  }

  return {
    x: bx,
    y: by,
    w: bw,
    h: bh,
    corners: {
      tl: !snapL && !snapT ? r : 0,
      tr: !snapR && !snapT ? r : 0,
      br: !snapR && !snapB ? r : 0,
      bl: !snapL && !snapB ? r : 0,
    },
    snapL,
    snapT,
    snapR,
    snapB,
  };
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function roundedRectPath(
  ctx: AnyCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  { tl, tr, br, bl }: CornerRadii,
): void {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arc(x + w - br, y + h - br, br, 0, Math.PI / 2);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arc(x + tl, y + tl, tl, Math.PI, -Math.PI / 2);
  ctx.closePath();
}

// ── Blur worker pool ──────────────────────────────────────────────────────────

const POOL_SIZE = Math.min(4, navigator.hardwareConcurrency || 2);
const _blurWorkers: Worker[] = [];
let _blurWorkerNextId = 0;
let _poolRoundRobin = 0;
const _blurWorkerPending = new Map<number, (result: ArrayBuffer | null, error?: string) => void>();

function makeBlurWorker(): Worker {
  const w = new Worker(new URL('./blurWorker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent) => {
    const { id, blurred, error } = e.data as { id: number; blurred?: ArrayBuffer; error?: string };
    const resolve = _blurWorkerPending.get(id);
    _blurWorkerPending.delete(id);
    resolve?.(blurred ?? null, error);
  };
  w.onerror = (e: ErrorEvent) => {
    const err = e.message || 'blur worker crashed';
    for (const resolve of _blurWorkerPending.values()) resolve(null, err);
    _blurWorkerPending.clear();
    const idx = _blurWorkers.indexOf(w);
    if (idx !== -1) _blurWorkers.splice(idx, 1);
  };
  return w;
}

function getBlurWorker(): Worker {
  if (_blurWorkers.length < POOL_SIZE) {
    const w = makeBlurWorker();
    _blurWorkers.push(w);
    return w;
  }
  const w = _blurWorkers[_poolRoundRobin % _blurWorkers.length];
  _poolRoundRobin++;
  return w;
}

function stackBlurInWorker(pixels: ArrayBuffer, width: number, height: number, strength: number): Promise<ArrayBuffer> {
  const id = _blurWorkerNextId++;
  const worker = getBlurWorker();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    _blurWorkerPending.set(id, (result, error) => {
      if (result !== null && result !== undefined) resolve(result);
      else reject(new Error(error ?? 'blur worker error'));
    });
    worker.postMessage({ id, pixels, width, height, strength }, [pixels]);
  });
}

// ── SDF mask ──────────────────────────────────────────────────────────────────
//
// Replaces the CSS-filter + StackBlur fallback previously used for mask
// creation. For each pixel in the sampling region, we compute the signed
// distance to the (rounded) detection box, then map it through a linear
// falloff over [0, feather] to get a per-pixel alpha weight.
//
// This is O(w×h) pure arithmetic — no canvas API, no StackBlur — and is
// typically 5–10 ms even for large 4K detection regions, vs. 50–100 ms for
// the StackBlur path it replaces.

/**
 * Signed-distance approximation to a rounded rectangle with per-corner radii.
 *
 * Returns:
 *   < 0  inside the shape (boundary = 0)
 *   > 0  outside by that many pixels
 *
 * For the quadrant containing (px, py) we pick the nearest corner's radius
 * and use the standard SDF formula; this is exact for the flat-edge regions
 * and exact at corners with uniform radii, and a close approximation when
 * adjacent corners have different radii.
 */
function sdfRoundedRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): number {
  const r = px < cx ? (py < cy ? tl : bl) : py < cy ? tr : br;
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Build a Float32Array alpha mask for the blur blend.
 *
 * The mask is in sampling-region coordinates (w×h pixels).
 * The detection box occupies [ox, oy, ox+dw, oy+dh] within the mask.
 *
 * alpha[i] = 1.0 → pixel fully covered by blur
 * alpha[i] = 0.0 → pixel is plain (no blur)
 * alpha[i] ∈ (0,1) → feathered edge (linear ramp over `feather` pixels)
 *
 * Snap flags suppress feathering on edges that are flush with the canvas
 * border by clamping the effective pixel coordinate so out-of-box pixels
 * on that side still read as "inside".
 */
function buildMaskSDF(
  w: number,
  h: number,
  feather: number,
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  { tl, tr, br, bl }: CornerRadii,
  snapL: boolean,
  snapT: boolean,
  snapR: boolean,
  snapB: boolean,
): Float32Array {
  const mask = new Float32Array(w * h);
  const cx = ox + dw / 2;
  const cy = oy + dh / 2;
  const hx = dw / 2;
  const hy = dh / 2;
  const invFeather = 1 / feather;

  for (let py = 0; py < h; py++) {
    // On snapped top/bottom edges: clamp py so pixels outside the box edge
    // still see a "inside" distance on that side.
    const epy = snapT && py < oy ? oy : snapB && py > oy + dh ? oy + dh : py;
    for (let px = 0; px < w; px++) {
      const epx = snapL && px < ox ? ox : snapR && px > ox + dw ? ox + dw : px;
      const dist = sdfRoundedRect(epx, epy, cx, cy, hx, hy, tl, tr, br, bl);
      let alpha: number;
      if (dist <= 0) {
        alpha = 1;
      } else if (dist >= feather) {
        alpha = 0;
      } else {
        alpha = 1 - dist * invFeather;
      }
      mask[py * w + px] = alpha;
    }
  }
  return mask;
}

// ── Blurrer ───────────────────────────────────────────────────────────────────

export class Blurrer {
  readonly #cache = new Map<string, Float32Array>();
  readonly #maxSize: number;
  // Incremented at the start of every apply() call. #blurArea captures the
  // value and checks it before putImageData — if it has changed, a newer
  // render has started and this (stale) result is discarded rather than
  // overwriting the canvas.
  #version = 0;

  constructor(maxSize = 64) {
    this.#maxSize = maxSize;
  }

  async apply(ctx: AnyCtx, detections: Detection[], mode: 'blur' | 'solidcolor' | 'pixelate', color = '#000000'): Promise<void> {
    const version = ++this.#version;
    const cw = (ctx as CanvasRenderingContext2D).canvas.width;
    const ch = (ctx as CanvasRenderingContext2D).canvas.height;

    if (mode !== 'blur') {
      for (const d of detections) {
        const r = Math.round((Math.min(d.w, d.h) / 2) * CORNER_RATIOS[d.label]);
        const box = clipToEdges(d.x, d.y, d.w, d.h, r, cw, ch);
        if (mode === 'solidcolor') this.#solidArea(ctx, box, color);
        else this.#pixelateArea(ctx, box, cw);
      }
      return;
    }

    // Precompute each detection's sampling region (box extended by 2×feather).
    // Used to detect overlaps so we never run two blurs concurrently when their
    // regions touch — that would cause each to putImageData original pixels over
    // the other's result.
    type BlurItem = { box: ClippedBox; xi: number; yi: number; xe: number; ye: number };
    const items: BlurItem[] = detections.map(d => {
      const r = Math.round((Math.min(d.w, d.h) / 2) * CORNER_RATIOS[d.label]);
      const box = clipToEdges(d.x, d.y, d.w, d.h, r, cw, ch);
      const feather = Math.round(Math.max(3, Math.max(box.w, box.h) / 12));
      return {
        box,
        xi: Math.max(0, Math.floor(box.x - feather * 2)),
        yi: Math.max(0, Math.floor(box.y - feather * 2)),
        xe: Math.min(cw, Math.ceil(box.x + box.w + feather * 2)),
        ye: Math.min(ch, Math.ceil(box.y + box.h + feather * 2)),
      };
    });

    // Greedy batch grouping: pack as many non-overlapping detections as possible
    // into each batch.  Batches run sequentially; within a batch, blurs run in
    // parallel (safe because their sampling regions don't touch).
    const batches: number[][] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      let placed = false;
      for (const batch of batches) {
        const fits = batch.every(j => {
          const b = items[j];
          return a.xe <= b.xi || b.xe <= a.xi || a.ye <= b.yi || b.ye <= a.yi;
        });
        if (fits) { batch.push(i); placed = true; break; }
      }
      if (!placed) batches.push([i]);
    }

    for (const batch of batches) {
      await Promise.all(batch.map(i => this.#blurArea(ctx, items[i].box, cw, ch, version)));
    }
  }

  // ── Solid color ─────────────────────────────────────────────────────────────

  #solidArea(ctx: AnyCtx, box: ClippedBox, color: string): void {
    ctx.save();
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, box.corners);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ── Pixelate ────────────────────────────────────────────────────────────────

  #pixelateArea(ctx: AnyCtx, box: ClippedBox, cw: number): void {
    const x = Math.round(box.x);
    const y = Math.round(box.y);
    const w = Math.round(box.w);
    const h = Math.round(box.h);
    if (w <= 0 || h <= 0) return;

    // Block size scales with detection size and image resolution so pixelation
    // looks visually similar regardless of canvas resolution.
    const resFactor = Math.max(1, cw / 1280);
    const pixelSize = Math.max(8, Math.min(60, Math.round((Math.min(w, h) / 8) * resFactor)));

    const cols = Math.ceil(w / pixelSize);
    const rows = Math.ceil(h / pixelSize);

    // Scale down to block resolution (GPU averages pixels), then scale back up
    // with nearest-neighbor — avoids O(w×h) JS pixel loops entirely.
    const small = new OffscreenCanvas(cols, rows);
    const smallCtx = small.getContext('2d')!;
    smallCtx.drawImage(ctx.canvas as unknown as OffscreenCanvas, x, y, w, h, 0, 0, cols, rows);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
    ctx.restore();
  }

  // ── Blur ────────────────────────────────────────────────────────────────────

  async #blurArea(ctx: AnyCtx, box: ClippedBox, cw: number, ch: number, version: number): Promise<void> {
    const { x, y, w, h, corners, snapL, snapT, snapR, snapB } = box;
    const feather = Math.round(Math.max(3, Math.max(w, h) / 12));

    // Sampling region: extend 2×feather outside the detection box, clamped to canvas.
    const xi = Math.max(0, Math.floor(x - feather * 2));
    const yi = Math.max(0, Math.floor(y - feather * 2));
    const xe = Math.min(cw, Math.ceil(x + w + feather * 2));
    const ye = Math.min(ch, Math.ceil(y + h + feather * 2));
    let wi = xe - xi;
    let hi = ye - yi;

    // Snap dimensions to nearest 5 for better cache hit rate.
    const mod = 5;
    wi = Math.min(wi + mod - (wi % mod), cw - xi);
    hi = Math.min(hi + mod - (hi % mod), ch - yi);
    if (wi <= 0 || hi <= 0) return;

    // Offset of the detection box within the sampling region.
    const ox = x - xi;
    const oy = y - yi;

    const strength = Math.max(10, Math.min(50, Math.round((wi * hi) / 100)));

    // getImageData: blocking but fast (only the sampling region, not full canvas).
    const plain = ctx.getImageData(xi, yi, wi, hi);

    // Clone the plain pixels — the copy is sent to the worker for blurring
    // (zero-copy transfer via ArrayBuffer), while we keep `plain` for the blend.
    const blurBuf = plain.data.buffer.slice(0);

    // StackBlur runs in the worker; the main thread is free during this await.
    let blurredBuf: ArrayBuffer;
    try {
      blurredBuf = await stackBlurInWorker(blurBuf, wi, hi, strength);
    } catch {
      // Worker failure: fall back to synchronous StackBlur in the main thread.
      // This avoids a visible glitch at the cost of a temporary frame hang.
      const { imageDataRGB } = await import('stackblur-canvas');
      const fallback = ctx.getImageData(xi, yi, wi, hi);
      imageDataRGB(fallback, 0, 0, wi, hi, strength);
      blurredBuf = fallback.data.buffer;
    }

    // If a newer apply() call started while we were awaiting the worker,
    // discard this result rather than overwriting the canvas with stale pixels.
    if (this.#version !== version) return;

    // Alpha-blend: blurred × mask + plain × (1-mask).
    const mask = this.#getMask(wi, hi, feather, ox, oy, w, h, corners, snapL, snapT, snapR, snapB);
    const blurredPx = new Uint8ClampedArray(blurredBuf);
    const plainPx = plain.data;
    for (let i = 0; i < blurredPx.length; i += 4) {
      const a = mask[i >> 2];
      blurredPx[i]     = blurredPx[i]     * a + plainPx[i]     * (1 - a);
      blurredPx[i + 1] = blurredPx[i + 1] * a + plainPx[i + 1] * (1 - a);
      blurredPx[i + 2] = blurredPx[i + 2] * a + plainPx[i + 2] * (1 - a);
    }
    ctx.putImageData(new ImageData(blurredPx, wi, hi), xi, yi);
  }

  // ── SDF mask cache ──────────────────────────────────────────────────────────

  #getMask(
    w: number,
    h: number,
    feather: number,
    ox: number,
    oy: number,
    dw: number,
    dh: number,
    corners: CornerRadii,
    snapL: boolean,
    snapT: boolean,
    snapR: boolean,
    snapB: boolean,
  ): Float32Array {
    const cf =
      (corners.tl > 0 ? 8 : 0) | (corners.tr > 0 ? 4 : 0) | (corners.br > 0 ? 2 : 0) | (corners.bl > 0 ? 1 : 0);
    const r = Math.max(corners.tl, corners.tr, corners.br, corners.bl);
    const sf = (snapL ? 8 : 0) | (snapT ? 4 : 0) | (snapR ? 2 : 0) | (snapB ? 1 : 0);
    const key = `${w}-${h}-${r}-${feather}-${cf}-${sf}-${Math.round(ox)}-${Math.round(oy)}-${Math.round(dw)}-${Math.round(dh)}`;
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      // LRU: move to end.
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    const mask = buildMaskSDF(w, h, feather, ox, oy, dw, dh, corners, snapL, snapT, snapR, snapB);
    this.#cache.set(key, mask);
    if (this.#cache.size > this.#maxSize) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }
    return mask;
  }
}

export const blurrer = new Blurrer(64);

// Expose for Playwright unit tests (direct blurrer invocation without inference).
(window as unknown as Record<string, unknown>).__blurrer = blurrer;
