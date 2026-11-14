/**
 * 360° equirectangular panoramas wrap around horizontally: column W-1 is the
 * neighbour of column 0 on the sphere. Detection and redaction treat such
 * images as periodic in x so that nothing on the seam is cut in two.
 *
 * Wrapping is enabled only from GPano XMP metadata (never guessed from a 2:1
 * aspect ratio): wrapping a normal wide photo would blend its two edges.
 */

import { GPANO_NS, parseGPano } from './jpegUtils';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Find the XMP packet by walking the JPEG segment headers with small reads,
 * so the file is never loaded as a whole. Stops at the first SOS marker.
 */
async function readJpegXmp(file: File): Promise<string | null> {
  const read = async (start: number, len: number) =>
    new Uint8Array(await file.slice(start, start + len).arrayBuffer());
  const soi = await read(0, 2);
  if (soi[0] !== 0xff || soi[1] !== 0xd8) return null;
  let pos = 2;
  for (let n = 0; n < 64 && pos + 4 <= file.size; n++) {
    const hdr = await read(pos, 4);
    if (hdr[0] !== 0xff) return null;
    const marker = hdr[1];
    if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI
    const segLen = (hdr[2] << 8) | hdr[3];
    if (marker === 0xe1 && segLen - 2 > XMP_HEADER.length) {
      const body = await read(pos + 4, segLen - 2);
      if (String.fromCharCode(...body.subarray(0, XMP_HEADER.length)) === XMP_HEADER) {
        return new TextDecoder().decode(body.subarray(XMP_HEADER.length));
      }
    }
    pos += 2 + segLen;
  }
  return null;
}

/**
 * True if the GPano metadata describes a full 360° equirectangular image,
 * i.e. the left and right edges meet. A horizontally cropped panorama
 * (CroppedAreaImageWidthPixels < FullPanoWidthPixels) does not wrap.
 */
export function gpanoWrapsHorizontally(xmp: string): boolean {
  const g = parseGPano(xmp);
  if (!g || g.get('ProjectionType')?.toLowerCase() !== 'equirectangular') return false;
  const full = Number(g.get('FullPanoWidthPixels'));
  const cropped = Number(g.get('CroppedAreaImageWidthPixels'));
  // Without both widths, assume the usual full panorama.
  if (!(full > 0) || !(cropped > 0)) return true;
  return cropped >= full;
}

const wrapCache = new WeakMap<File, Promise<boolean>>();

/** Whether `file` is a 360° panorama whose left and right edges meet (cached per File). */
export function isWrapPanorama(file: File): Promise<boolean> {
  let p = wrapCache.get(file);
  if (!p) {
    p = file.type !== 'image/jpeg'
      ? Promise.resolve(false)
      : readJpegXmp(file)
        .then((xmp) => !!xmp && xmp.includes(GPANO_NS) && gpanoWrapsHorizontally(xmp))
        .catch((err) => {
          console.warn('[panorama] XMP read failed:', err);
          return false;
        });
    p.then((wrap) => { if (wrap) console.log(`[panorama] ${file.name}: 360° equirectangular, wrapping at the seam`); });
    wrapCache.set(file, p);
  }
  return p;
}

// ── Region access across the seam ─────────────────────────────────────────────

/**
 * The parts of the horizontal span [x, x+w) on a canvas of width cw, as
 * (canvas x, offset within the span, width) triples. With wrap, x may be
 * outside [0, cw) and the span may cross the seam; w must not exceed cw.
 */
function wrappedSpans(x: number, w: number, cw: number): Array<{ cx: number; off: number; w: number }> {
  const start = ((x % cw) + cw) % cw;
  const first = Math.min(w, cw - start);
  const spans = [{ cx: start, off: 0, w: first }];
  if (first < w) spans.push({ cx: 0, off: first, w: w - first });
  return spans;
}

/**
 * getImageData for a region that may cross the seam of a wrapping canvas.
 * Integer coordinates; `w` must not exceed the canvas width.
 */
export function readWrapped(ctx: AnyCtx, x: number, y: number, w: number, h: number): ImageData {
  const cw = ctx.canvas.width;
  const spans = wrappedSpans(x, w, cw);
  if (spans.length === 1) return ctx.getImageData(spans[0].cx, y, w, h);
  const out = new ImageData(w, h);
  for (const s of spans) {
    const part = ctx.getImageData(s.cx, y, s.w, h).data;
    for (let row = 0; row < h; row++) {
      out.data.set(part.subarray(row * s.w * 4, (row + 1) * s.w * 4), (row * w + s.off) * 4);
    }
  }
  return out;
}

/** putImageData counterpart of readWrapped(). */
export function writeWrapped(ctx: AnyCtx, img: ImageData, x: number, y: number): void {
  const cw = ctx.canvas.width;
  for (const s of wrappedSpans(x, img.width, cw)) {
    // Dirty-rect form: place the whole image so that its column `off` lands on
    // canvas column `cx`, but only write that span.
    ctx.putImageData(img, s.cx - s.off, y, s.off, 0, s.w, img.height);
  }
}

/** Shift x into [0, cw). */
export function wrapX(x: number, cw: number): number {
  return ((x % cw) + cw) % cw;
}
