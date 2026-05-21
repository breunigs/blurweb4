/**
 * Renders detection results onto a canvas — either as labeled outlines
 * or as blurred/pixelated regions depending on the active draw mode.
 */

import { blurrer } from './blurrer';
import type { Detection } from './detector';
import type { DrawMode } from './config';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// 4 high-contrast reds/oranges for 'plate', 4 blues/cyans for 'person'.
// Chosen to stand out against typical outdoor/street photo backgrounds.
const LABEL_COLORS: Record<string, string[]> = {
  plate:  ['#ff3b30', '#ff9500', '#ff2d55', '#ffcc00'],
  person: ['#0a84ff', '#5ac8fa', '#30d158', '#64d2ff'],
};

function drawOutline(ctx: AnyCtx, detections: Detection[]): void {
  if (detections.length === 0) return;
  ctx.save();
  // Scale font to the shorter canvas dimension so labels are readable regardless
  // of canvas resolution or CSS zoom. Use pixel dimensions (not clientWidth) so
  // this works even when the canvas is display:none (e.g. loaded in background).
  const fontSize = Math.max(11, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) * 0.012));
  ctx.font = `${fontSize}px monospace`;
  // Track per-label index so consecutive detections of the same label cycle through hues.
  const labelIdx: Record<string, number> = {};
  for (const d of detections) {
    const palette = LABEL_COLORS[d.label] ?? ['#ffffff'];
    const idx = labelIdx[d.label] ?? 0;
    labelIdx[d.label] = idx + 1;
    const color = palette[idx % palette.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    const label = `${d.label} ${Math.round(d.conf * 100)}%`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(d.x, d.y - fontSize, tw + 4, fontSize);
    ctx.fillStyle = color;
    ctx.fillText(label, d.x + 2, d.y - 5);
  }
  ctx.restore();
}

/** Apply detections to the canvas using the current draw mode. */
export function applyDetections(ctx: AnyCtx, detections: Detection[], mode: DrawMode, color = '#000000'): void {
  if (detections.length === 0) return;
  if (mode === 'outline') {
    drawOutline(ctx, detections);
  } else {
    blurrer.apply(ctx, detections, mode, color);
  }
}
