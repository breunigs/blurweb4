/**
 * Pinch-to-zoom for the canvas preview (touch devices).
 *
 * One controller is attached to `#preview-area` and operates on whichever
 * `.canvas-wrapper.active canvas` is currently shown. The zoom is a pure CSS
 * transform on the canvas element — nothing is re-rendered, so it works the
 * same for images and for video frames while scrubbing.
 *
 * Gestures:
 *   two fingers  → pinch to zoom around the gesture midpoint, drag to pan.
 *                  Capped at one canvas pixel per device pixel — see maxScale()
 *   one finger   → pan (only while zoomed in; at fit scale the swipe-navigation
 *                  in fileManager.ts keeps working)
 *   double tap   → zoom back out to fit
 *
 * `#preview-area` is `touch-action: pan-y` in CSS (fit — the page still scrolls
 * vertically, but the browser never page-zooms over the preview); while zoomed
 * in it is switched to `none` so every touch belongs to us. The browser reads
 * touch-action at touchstart, so it must be updated as the scale changes.
 */

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;

export class CanvasZoom {
  private scale = 1;
  private tx = 0;
  private ty = 0;

  // Gesture state
  private multiTouch = false;
  private startScale = 1;
  private startTx = 0;
  private startTy = 0;
  private startDist = 0;
  private startMidX = 0;
  private startMidY = 0;
  private panX = 0;
  private panY = 0;
  private panning = false;

  private tapStartX = 0;
  private tapStartY = 0;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(private readonly previewArea: HTMLElement) {
    previewArea.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    previewArea.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    previewArea.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    previewArea.addEventListener('touchcancel', () => this.endGesture(), { passive: true });

    // iOS Safari ignores `touch-action` for its own pinch-to-zoom of the page:
    // it keeps magnifying past our cap, which is what makes the image go soft.
    // The non-standard gesture* events are the only way to suppress it.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      previewArea.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }

    // Rotating the device changes the fit width, and with it the pixel budget.
    window.addEventListener('resize', () => {
      if (this.isZoomed()) this.apply();
    });
  }

  /** True while the preview is zoomed in — swipe navigation defers to panning. */
  isZoomed(): boolean {
    return this.scale > 1.01;
  }

  /** Zoom back out to fit. Called on file switch and by the double-tap handler. */
  reset(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.endGesture();
    // Clear every canvas, not just the active one: switchTo() resets after the
    // .active class has already moved to the new wrapper.
    for (const canvas of this.previewArea.querySelectorAll<HTMLCanvasElement>('.canvas-wrapper canvas')) {
      canvas.style.transform = '';
    }
    this.previewArea.style.touchAction = '';
  }

  private activeCanvas(): HTMLCanvasElement | null {
    return this.previewArea.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas');
  }

  private apply(): void {
    const canvas = this.activeCanvas();
    if (!canvas) return;
    // Backstop: the gesture clamps too, but the budget also shrinks on rotate/resize.
    this.scale = Math.min(this.scale, this.maxScale(canvas));
    this.clampPan(canvas);
    canvas.style.transformOrigin = 'center center';
    canvas.style.transform = this.scale === 1
      ? ''
      : `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    // Set on the whole preview area so panning also works when a finger lands
    // on the letterbox next to the canvas. Re-evaluated at the next touchstart.
    this.previewArea.style.touchAction = this.isZoomed() ? 'none' : '';
  }

  /**
   * Upper zoom limit: one canvas pixel per device pixel. Zooming further only
   * magnifies the preview render, it shows no additional detail.
   *
   * The canvas holds the frame at its full source resolution and CSS shrinks it
   * to fit, so the headroom is however much that fit scale shrank it by. Never
   * below 1 — a frame smaller than the preview box is already past 1:1 at fit.
   */
  private maxScale(canvas: HTMLCanvasElement): number {
    const baseW = canvas.getBoundingClientRect().width / this.scale;
    if (baseW <= 0) return 1;
    const dpr = window.devicePixelRatio || 1;
    return Math.max(1, canvas.width / (baseW * dpr));
  }

  /** Keep the scaled canvas covering the viewport — no panning into empty space. */
  private clampPan(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    // getBoundingClientRect() is post-transform; recover the untransformed size.
    const baseW = rect.width / this.scale;
    const baseH = rect.height / this.scale;
    const maxX = Math.max(0, (baseW * this.scale - baseW) / 2);
    const maxY = Math.max(0, (baseH * this.scale - baseH) / 2);
    this.tx = Math.min(maxX, Math.max(-maxX, this.tx));
    this.ty = Math.min(maxY, Math.max(-maxY, this.ty));
  }

  private endGesture(): void {
    this.multiTouch = false;
    this.panning = false;
    this.startDist = 0;
  }

  private onTouchStart(e: TouchEvent): void {
    if (!this.activeCanvas()) return;
    if (e.touches.length >= 2) this.multiTouch = true;

    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      this.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this.startMidX = (a.clientX + b.clientX) / 2;
      this.startMidY = (a.clientY + b.clientY) / 2;
      this.startScale = this.scale;
      this.startTx = this.tx;
      this.startTy = this.ty;
      this.panning = false;
    } else if (e.touches.length === 1) {
      this.tapStartX = e.touches[0].clientX;
      this.tapStartY = e.touches[0].clientY;
      if (this.isZoomed()) {
        this.panning = true;
        this.panX = this.tapStartX;
        this.panY = this.tapStartY;
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 2 && this.startDist > 0) {
      e.preventDefault();
      const canvas = this.activeCanvas();
      if (!canvas) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;

      const max = this.maxScale(canvas);
      const next = Math.min(max, Math.max(1, this.startScale * (dist / this.startDist)));
      const ratio = next / this.startScale;
      // Keep the point under the gesture midpoint stationary, then follow the
      // midpoint itself so a two-finger drag pans as well.
      this.tx = this.startTx * ratio + (midX - this.startMidX);
      this.ty = this.startTy * ratio + (midY - this.startMidY);
      this.scale = next;
      this.apply();
    } else if (this.panning && e.touches.length === 1) {
      e.preventDefault();
      this.tx += e.touches[0].clientX - this.panX;
      this.ty += e.touches[0].clientY - this.panY;
      this.panX = e.touches[0].clientX;
      this.panY = e.touches[0].clientY;
      this.apply();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (e.touches.length === 0) {
      const wasMultiTouch = this.multiTouch;
      this.endGesture();
      if (wasMultiTouch) this.logZoom();
      else this.handleTap(e);
    } else {
      // A finger was lifted mid-pinch — restart the gesture from what remains.
      this.startDist = 0;
      this.panning = this.isZoomed() && e.touches.length === 1;
      if (this.panning) {
        this.panX = e.touches[0].clientX;
        this.panY = e.touches[0].clientY;
      }
    }
  }

  /**
   * Report where a pinch landed relative to the pixel budget. Shows up in the
   * debug panel, so a device that still looks soft can be checked directly:
   * `visual` > 1 means something outside this module magnified the page too.
   */
  private logZoom(): void {
    const canvas = this.activeCanvas();
    if (!canvas) return;
    const baseW = canvas.getBoundingClientRect().width / this.scale;
    const visual = window.visualViewport?.scale ?? 1;
    console.log(
      `[zoom] scale=${this.scale.toFixed(2)} max=${this.maxScale(canvas).toFixed(2)} `
      + `canvas=${canvas.width}x${canvas.height} fitW=${baseW.toFixed(1)}css `
      + `dpr=${window.devicePixelRatio} visual=${visual.toFixed(2)}`,
    );
  }

  /** Double tap anywhere on the preview zooms back out to fit. */
  private handleTap(e: TouchEvent): void {
    const touch = e.changedTouches[0];
    if (!touch) return;
    // A drag (pan or navigation swipe) is not a tap.
    if (Math.abs(touch.clientX - this.tapStartX) > DOUBLE_TAP_SLOP_PX
      || Math.abs(touch.clientY - this.tapStartY) > DOUBLE_TAP_SLOP_PX) {
      this.lastTapTime = 0;
      return;
    }
    const now = performance.now();
    const isDouble = now - this.lastTapTime < DOUBLE_TAP_MS
      && Math.abs(touch.clientX - this.lastTapX) < DOUBLE_TAP_SLOP_PX
      && Math.abs(touch.clientY - this.lastTapY) < DOUBLE_TAP_SLOP_PX;

    if (isDouble) {
      this.lastTapTime = 0;
      if (this.isZoomed()) {
        e.preventDefault(); // suppress the synthetic click / browser double-tap zoom
        this.reset();
      }
      return;
    }
    this.lastTapTime = now;
    this.lastTapX = touch.clientX;
    this.lastTapY = touch.clientY;
  }
}
