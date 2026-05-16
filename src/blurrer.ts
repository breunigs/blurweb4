/**
 * Blur and blackout rendering for detected regions.
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
 */

import { imageDataRGB } from 'stackblur-canvas';
import type { Detection } from './detector';

// ── Corner ratios ─────────────────────────────────────────────────────────────

const CORNER_RATIOS: Record<'plate' | 'person', number> = { plate: 0.95, person: 0.80 };

/** Fraction of the canvas dimension within which a box edge is snapped to the border. */
const EDGE_THRESHOLD = 0.005; // 0.5 %

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface CornerRadii { tl: number; tr: number; br: number; bl: number; }

interface ClippedBox {
  x: number; y: number; w: number; h: number;
  corners: CornerRadii;
  snapL: boolean; snapT: boolean; snapR: boolean; snapB: boolean;
}

// ── Edge clamping ─────────────────────────────────────────────────────────────

function clipToEdges(
  x: number, y: number, w: number, h: number,
  r: number,
  cw: number, ch: number,
): ClippedBox {
  const thX = cw * EDGE_THRESHOLD;
  const thY = ch * EDGE_THRESHOLD;
  let bx = x, by = y, bw = w, bh = h;
  let snapL = false, snapT = false, snapR = false, snapB = false;

  if (x         < thX)      { bw += bx; bx = 0;       snapL = true; }
  if (y         < thY)      { bh += by; by = 0;        snapT = true; }
  if (x + w > cw - thX)     { bw = cw - bx;           snapR = true; }
  if (y + h > ch - thY)     { bh = ch - by;            snapB = true; }

  return {
    x: bx, y: by, w: bw, h: bh,
    corners: {
      tl: (!snapL && !snapT) ? r : 0,
      tr: (!snapR && !snapT) ? r : 0,
      br: (!snapR && !snapB) ? r : 0,
      bl: (!snapL && !snapB) ? r : 0,
    },
    snapL, snapT, snapR, snapB,
  };
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function roundedRectPath(
  ctx: AnyCtx,
  x: number, y: number, w: number, h: number,
  { tl, tr, br, bl }: CornerRadii,
): void {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arc(x + w - tr, y + tr,     tr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arc(x + w - br, y + h - br, br, 0,            Math.PI / 2);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arc(x + bl,     y + h - bl, bl, Math.PI / 2,  Math.PI);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arc(x + tl,     y + tl,     tl, Math.PI,      -Math.PI / 2);
  ctx.closePath();
}

// ── Blurrer ───────────────────────────────────────────────────────────────────

export class Blurrer {
  readonly #cache = new Map<string, Float32Array>();
  readonly #maxSize: number;

  constructor(maxSize = 64) {
    this.#maxSize = maxSize;
  }

  apply(ctx: AnyCtx, detections: Detection[], mode: 'blur' | 'blackout'): void {
    const cw = (ctx as CanvasRenderingContext2D).canvas.width;
    const ch = (ctx as CanvasRenderingContext2D).canvas.height;
    for (const d of detections) {
      const r = Math.round(Math.min(d.w, d.h) / 2 * CORNER_RATIOS[d.label]);
      const box = clipToEdges(d.x, d.y, d.w, d.h, r, cw, ch);
      if (mode === 'blackout') this.#blackArea(ctx, box);
      else                     this.#blurArea(ctx, box, cw, ch);
    }
  }

  // ── Blackout ────────────────────────────────────────────────────────────────

  #blackArea(ctx: AnyCtx, box: ClippedBox): void {
    ctx.save();
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, box.corners);
    ctx.fillStyle = 'black';
    ctx.fill();
    ctx.restore();
  }

  // ── Blur ────────────────────────────────────────────────────────────────────

  #blurArea(ctx: AnyCtx, box: ClippedBox, cw: number, ch: number): void {
    const { x, y, w, h, corners, snapL, snapT, snapR, snapB } = box;
    const feather = Math.round(Math.max(3, Math.max(w, h) / 12));

    // Sampling region: extend 2×feather outside the detection box, clamped to canvas.
    const xi = Math.max(0,  Math.floor(x - feather * 2));
    const yi = Math.max(0,  Math.floor(y - feather * 2));
    const xe = Math.min(cw, Math.ceil(x + w + feather * 2));
    const ye = Math.min(ch, Math.ceil(y + h + feather * 2));
    let   wi = xe - xi;
    let   hi = ye - yi;

    // Snap dimensions to nearest 5 for better cache hit rate.
    const mod = 5;
    wi = Math.min(wi + mod - (wi % mod), cw - xi);
    hi = Math.min(hi + mod - (hi % mod), ch - yi);
    if (wi <= 0 || hi <= 0) return;

    // Offset of the detection box within the sampling region.
    const ox = x - xi;
    const oy = y - yi;

    const mask = this.#getMask(
      wi, hi, feather, ox, oy, w, h, corners,
      snapL, snapT, snapR, snapB,
    );
    const strength = Math.max(10, Math.min(50, Math.round(wi * hi / 100)));

    const plain   = ctx.getImageData(xi, yi, wi, hi);
    const blurred = ctx.getImageData(xi, yi, wi, hi);
    imageDataRGB(blurred, 0, 0, wi, hi, strength);

    const { data: bp } = blurred;
    const { data: pp } = plain;
    for (let i = 0; i < bp.length; i += 4) {
      const a = mask[i >> 2];
      bp[i]     = bp[i]     * a + pp[i]     * (1 - a);
      bp[i + 1] = bp[i + 1] * a + pp[i + 1] * (1 - a);
      bp[i + 2] = bp[i + 2] * a + pp[i + 2] * (1 - a);
    }

    ctx.putImageData(blurred, xi, yi);
  }

  // ── LRU mask cache ──────────────────────────────────────────────────────────

  #getMask(
    w: number, h: number, feather: number,
    ox: number, oy: number, dw: number, dh: number,
    corners: CornerRadii,
    snapL: boolean, snapT: boolean, snapR: boolean, snapB: boolean,
  ): Float32Array {
    const cf = (corners.tl > 0 ? 8 : 0) | (corners.tr > 0 ? 4 : 0)
             | (corners.br > 0 ? 2 : 0) | (corners.bl > 0 ? 1 : 0);
    const r = Math.max(corners.tl, corners.tr, corners.br, corners.bl);
    const sf = (snapL ? 8 : 0) | (snapT ? 4 : 0) | (snapR ? 2 : 0) | (snapB ? 1 : 0);
    const key = `${w}-${h}-${r}-${feather}-${cf}-${sf}-${Math.round(ox)}-${Math.round(oy)}-${Math.round(dw)}-${Math.round(dh)}`;
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    const mask = this.#createMask(
      w, h, feather, ox, oy, dw, dh, corners,
      snapL, snapT, snapR, snapB,
    );
    this.#cache.set(key, mask);
    if (this.#cache.size > this.#maxSize) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }
    return mask;
  }

  /**
   * Create an alpha mask for the blur blend.
   *
   * The mask is in sampling-region coordinates (w×h).
   * The detection box occupies [ox, oy, ox+dw, oy+dh] within the mask.
   *
   * Strategy (two-pass):
   *   Pass 1: draw an outer shape expanded by feather on all free sides (and 2×feather
   *           on snapped sides so the blur clips cleanly at the image border), then
   *           blur by feather. This creates the feathered falloff *outside* the box.
   *   Pass 2: overdraw the detection box interior solid white (no filter). This pins
   *           the interior to 1.0 regardless of Gaussian taper, so the entire
   *           detection region is fully covered.
   */
  #createMask(
    w: number, h: number, feather: number,
    ox: number, oy: number, dw: number, dh: number,
    corners: CornerRadii,
    snapL: boolean, snapT: boolean, snapR: boolean, snapB: boolean,
  ): Float32Array {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false })!;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);

    // Outer shape: expand by feather on free sides, 2×feather on snapped sides
    // so the Gaussian can clip cleanly at the image border.
    const ex  = snapL ? ox - feather * 2 : ox - feather;
    const ey  = snapT ? oy - feather * 2 : oy - feather;
    const ex2 = snapR ? ox + dw + feather * 2 : ox + dw + feather;
    const ey2 = snapB ? oy + dh + feather * 2 : oy + dh + feather;
    const ew  = ex2 - ex;
    const eh  = ey2 - ey;

    const drawFeathered = (doBlur: boolean): void => {
      if (doBlur) (ctx as unknown as CanvasRenderingContext2D).filter = `blur(${feather}px)`;
      ctx.fillStyle = 'white';
      roundedRectPath(ctx, ex, ey, ew, eh, corners);
      ctx.fill();
      if (doBlur) (ctx as unknown as CanvasRenderingContext2D).filter = 'none';
    };

    // Pass 1 — feathered outer shape
    drawFeathered(true);

    // Detect no-op filter (Firefox/OffscreenCanvas): centre of detection box should be bright.
    const cx = Math.round(ox + dw / 2);
    const cy = Math.round(oy + dh / 2);
    const centreI = (Math.min(cy, h - 1) * w + Math.min(cx, w - 1)) * 4;
    let maskData = ctx.getImageData(0, 0, w, h);
    if (maskData.data[centreI] < 200) {
      // Fallback: draw unfiltered then StackBlur the whole mask for feathering.
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, w, h);
      drawFeathered(false);
      maskData = ctx.getImageData(0, 0, w, h);
      imageDataRGB(maskData, 0, 0, w, h, feather);
      ctx.putImageData(maskData, 0, 0);
    }

    // Pass 2 — solid interior: pin the detection box to fully white (mask = 1).
    ctx.fillStyle = 'white';
    roundedRectPath(ctx, ox, oy, dw, dh, corners);
    ctx.fill();

    maskData = ctx.getImageData(0, 0, w, h);
    const raw = new Float32Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = maskData.data[i * 4] / 255;
    return raw;
  }
}

export const blurrer = new Blurrer(64);

// Expose for Playwright unit tests (direct blurrer invocation without inference).
(window as unknown as Record<string, unknown>).__blurrer = blurrer;
