/**
 * Detection on 360° equirectangular panoramas.
 *
 * Letterboxing a 2:1 panorama into the square model input leaves half of it
 * as padding. We use that half: the input holds the panorama twice, stacked
 * (see captureSnapshot in detector.ts):
 *
 *   rows [0, copyH)        copy 0 — the panorama as is
 *   rows [copyH, 2·copyH)  copy 1 — the panorama rolled by half a turn, so
 *                          its middle column is the seam of copy 0
 *
 * Anything cut by the seam in copy 0 is whole in the middle of copy 1, at no
 * extra inference cost. This module maps the model's boxes from both copies
 * into one horizontally periodic coordinate system and removes duplicates.
 *
 * Pure functions, shared by the detector worker and the tests.
 */

export interface PanoLayout {
  /** Width of one copy in model pixels (one full turn). */
  copyW: number;
  /** Height of one copy in model pixels. */
  copyH: number;
  /** Copy 1 shows panorama column (u + half) mod copyW at its column u. */
  half: number;
}

export interface PanoCandidate {
  label: 'plate' | 'person';
  conf: number;
  /** Model-pixel centre and size, as the model outputs them. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface PanoDetection {
  label: 'plate' | 'person';
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box is cut by its copy's edge if it ends within this fraction of copyW of it. */
const EDGE_FRACTION = 0.005;
/** A box may reach this fraction of its height into the other copy before it is dropped. */
const MAX_SPILL = 0.3;
/** A cut box mostly inside a whole box of the same class is the same object. */
const CONTAIN_THRESHOLD = 0.6;
/** Two cut halves are one object if they overlap this much vertically. */
const PAIR_V_OVERLAP = 0.5;

interface Box {
  label: 'plate' | 'person';
  conf: number;
  /** Periodic coordinates in model pixels: x1 in [0, copyW), x2 may exceed copyW. */
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  /** Which copy the model saw it in; its seam is at x = copy · half (mod copyW). */
  copy: 0 | 1;
  /** Cut by the left / right edge of its copy. */
  cutL: boolean;
  cutR: boolean;
}

const cut = (b: Box) => b.cutL || b.cutR;
const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1);

/** Intersection area of a and b, trying b one turn left and right as well. */
function intersection(a: Box, b: Box, period: number): number {
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  if (iy === 0) return 0;
  let best = 0;
  for (const s of [-period, 0, period]) {
    const ix = Math.max(0, Math.min(a.x2, b.x2 + s) - Math.max(a.x1, b.x1 + s));
    best = Math.max(best, ix);
  }
  return best * iy;
}

function iou(a: Box, b: Box, period: number): number {
  const inter = intersection(a, b, period);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Map one model box into periodic panorama coordinates, or null if it is not usable. */
function toPeriodic(c: PanoCandidate, L: PanoLayout): Box | null {
  const copy: 0 | 1 = c.cy < L.copyH ? 0 : 1;
  if (c.cy >= 2 * L.copyH) return null; // in the grey fill below both copies
  const top = copy * L.copyH;
  let y1 = c.cy - c.h / 2 - top;
  let y2 = c.cy + c.h / 2 - top;
  // Boxes reaching into the other copy see both images at once: clip a little
  // spill, drop the rest.
  const inside = Math.min(y2, L.copyH) - Math.max(y1, 0);
  if (inside < (1 - MAX_SPILL) * c.h) return null;
  y1 = Math.max(0, y1);
  y2 = Math.min(L.copyH, y2);

  const tol = L.copyW * EDGE_FRACTION;
  let x1 = Math.max(0, c.cx - c.w / 2);
  let x2 = Math.min(L.copyW, c.cx + c.w / 2);
  const cutL = x1 <= tol;
  const cutR = x2 >= L.copyW - tol;
  if (copy === 1) {
    x1 += L.half;
    x2 += L.half;
  }
  if (x1 >= L.copyW) {
    x1 -= L.copyW;
    x2 -= L.copyW;
  }
  return { label: c.label, conf: c.conf, x1, x2, y1, y2, copy, cutL, cutR };
}

/**
 * NMS over both copies in periodic coordinates, then repair what the copy
 * edges cut: pair up the two halves of an object, and extend a lone half
 * across the edge where the rest of it must be.
 *
 * Returns boxes in source-image pixels; x is in [0, W) and x + w may exceed W
 * (the box continues on the left side of the image).
 */
export function postprocessPanorama(
  candidates: PanoCandidate[],
  L: PanoLayout,
  scale: number,
  iouThreshold: number,
): PanoDetection[] {
  const P = L.copyW;
  const boxes = candidates.map((c) => toPeriodic(c, L)).filter((b): b is Box => b !== null);

  const kept: Box[] = [];
  for (const label of ['plate', 'person'] as const) {
    // A whole box beats a cut one of similar confidence: rank cut boxes lower.
    const cls = boxes
      .filter((b) => b.label === label)
      .sort((a, b) => b.conf * (cut(b) ? 0.5 : 1) - a.conf * (cut(a) ? 0.5 : 1));
    const sup = new Uint8Array(cls.length);
    for (let i = 0; i < cls.length; i++) {
      if (sup[i]) continue;
      const k = { ...cls[i] };
      for (let j = i + 1; j < cls.length; j++) {
        if (sup[j]) continue;
        const o = cls[j];
        const dup =
          iou(k, o, P) > iouThreshold ||
          (cut(o) && !cut(k) && intersection(k, o, P) > CONTAIN_THRESHOLD * area(o));
        if (dup) {
          sup[j] = 1;
          // The kept box stands for the same object: never lose confidence by
          // suppressing, or a minConfidence filter could drop a real person.
          k.conf = Math.max(k.conf, o.conf);
        }
      }
      kept.push(k);
    }
  }

  // Pair cut halves: a box cut by the right edge of a copy and a box cut by
  // the left edge of the same copy meet at that copy's seam.
  const used = new Set<Box>();
  const out: Box[] = [];
  for (const a of kept) {
    if (used.has(a) || !a.cutR || a.cutL) continue;
    const partner = kept.find(
      (b) =>
        !used.has(b) && b !== a && b.label === a.label && b.copy === a.copy && b.cutL && !b.cutR &&
        Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) >= PAIR_V_OVERLAP * Math.min(a.y2 - a.y1, b.y2 - b.y1),
    );
    if (!partner) continue;
    used.add(a);
    used.add(partner);
    // a ends at the seam, partner starts there: join them across it.
    const seam = a.x2;
    out.push({
      ...a,
      conf: Math.max(a.conf, partner.conf),
      x2: seam + (partner.x2 - partner.x1),
      y1: Math.min(a.y1, partner.y1),
      y2: Math.max(a.y2, partner.y2),
      cutL: false,
      cutR: false,
    });
  }

  for (const b of kept) {
    if (used.has(b)) continue;
    if (cut(b) && !(b.cutL && b.cutR)) {
      // A lone half: the other copy did not see this object whole and no
      // matching half was found. The object continues past the edge; redact
      // a guess of the hidden part rather than leave it visible.
      const ext = Math.min(P / 4, Math.max(b.x2 - b.x1, 0.4 * (b.y2 - b.y1)));
      if (b.cutL) b.x1 -= ext;
      else b.x2 += ext;
      if (b.x1 < 0) {
        b.x1 += P;
        b.x2 += P;
      }
    }
    out.push(b);
  }

  return out.map((b) => ({
    label: b.label,
    conf: b.conf,
    x: Math.round(b.x1 / scale),
    y: Math.round(b.y1 / scale),
    w: Math.round((b.x2 - b.x1) / scale),
    h: Math.round((b.y2 - b.y1) / scale),
  }));
}
