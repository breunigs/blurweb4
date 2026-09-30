import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples');

/**
 * Dispatch a synthetic touch sequence on #preview-area.
 *
 * Playwright has no pinch API, so the gesture is built from raw TouchEvents.
 * Each step is a list of finger positions in CSS pixels relative to the
 * preview area's top-left corner.
 */
async function touchSequence(
  page: Page,
  steps: Array<{ type: 'touchstart' | 'touchmove' | 'touchend'; points: Array<[number, number]> }>,
): Promise<void> {
  await page.evaluate((steps) => {
    const area = document.getElementById('preview-area')!;
    const rect = area.getBoundingClientRect();
    for (const step of steps) {
      const touches = step.points.map(([x, y], i) => new Touch({
        identifier: i,
        target: area,
        clientX: rect.left + x,
        clientY: rect.top + y,
      }));
      // touchend reports the lifted fingers in changedTouches, not in touches.
      area.dispatchEvent(new TouchEvent(step.type, {
        bubbles: true,
        cancelable: true,
        touches: step.type === 'touchend' ? [] : touches,
        targetTouches: step.type === 'touchend' ? [] : touches,
        changedTouches: touches,
      }));
    }
  }, steps);
}

function canvasTransform(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!.style.transform);
}

test.describe('Canvas preview pinch-zoom', () => {
  // A touch-enabled context is needed for TouchEvent to exist at all.
  test.use({ hasTouch: true, viewport: { width: 420, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3100');
    const touchEvents = await page.evaluate(() => typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined');
    test.skip(!touchEvents, 'Browser does not expose constructable TouchEvent');
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
      return c !== null && c.width > 0;
    }, { timeout: 60_000 });
  });

  test('pinching out zooms the canvas in, double tap zooms back out', async ({ page }) => {
    expect(await canvasTransform(page), 'canvas starts unzoomed').toBe('');

    // Two fingers 40px apart, spread to 160px → ~4× (clamped by MAX_SCALE=8).
    await touchSequence(page, [
      { type: 'touchstart', points: [[160, 100], [200, 100]] },
      { type: 'touchmove', points: [[100, 100], [260, 100]] },
      { type: 'touchend', points: [[100, 100], [260, 100]] },
    ]);

    const zoomed = await canvasTransform(page);
    const scale = Number(/scale\(([\d.]+)\)/.exec(zoomed)?.[1]);
    expect(scale, `expected a zoomed-in transform, got "${zoomed}"`).toBeGreaterThan(2);

    // While zoomed the preview must own every touch, or the page scrolls instead of panning.
    expect(await page.evaluate(() => document.getElementById('preview-area')!.style.touchAction)).toBe('none');

    // Double tap → back to fit.
    await touchSequence(page, [
      { type: 'touchstart', points: [[180, 100]] },
      { type: 'touchend', points: [[180, 100]] },
      { type: 'touchstart', points: [[180, 100]] },
      { type: 'touchend', points: [[180, 100]] },
    ]);

    expect(await canvasTransform(page), 'double tap should zoom out fully').toBe('');
    expect(await page.evaluate(() => document.getElementById('preview-area')!.style.touchAction)).toBe('');
  });

  test('zoom stops at one canvas pixel per device pixel', async ({ page }) => {
    // Spread far beyond the available detail — the cap, not the gesture, decides.
    await touchSequence(page, [
      { type: 'touchstart', points: [[209, 100], [211, 100]] },
      { type: 'touchmove', points: [[10, 100], [410, 100]] },
      { type: 'touchend', points: [[10, 100], [410, 100]] },
    ]);

    const { scale, max } = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const s = Number(/scale\(([\d.]+)\)/.exec(canvas.style.transform)?.[1] ?? 1);
      const baseW = canvas.getBoundingClientRect().width / s;
      return { scale: s, max: canvas.width / (baseW * (window.devicePixelRatio || 1)) };
    });

    expect(max, 'test fixture must have zoom headroom to be meaningful').toBeGreaterThan(1.5);
    expect(scale, `zoom must not exceed native resolution (max ${max})`).toBeLessThanOrEqual(max + 0.01);
    expect(scale, 'zoom should reach the cap on a big spread').toBeGreaterThan(max - 0.01);
  });

  test('zoom is re-clamped when the preview grows', async ({ page }) => {
    const pixelBudget = () => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const s = Number(/scale\(([\d.]+)\)/.exec(canvas.style.transform)?.[1] ?? 1);
      const baseW = canvas.getBoundingClientRect().width / s;
      return { scale: s, max: canvas.width / (baseW * (window.devicePixelRatio || 1)) };
    });

    await touchSequence(page, [
      { type: 'touchstart', points: [[209, 100], [211, 100]] },
      { type: 'touchmove', points: [[10, 100], [410, 100]] },
      { type: 'touchend', points: [[10, 100], [410, 100]] },
    ]);
    const zoomed = await pixelBudget();

    // A wider preview fits more of the frame, so the remaining budget shrinks.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForFunction((before: number) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const s = Number(/scale\(([\d.]+)\)/.exec(canvas.style.transform)?.[1] ?? 1);
      return s < before;
    }, zoomed.scale);

    const after = await pixelBudget();
    expect(after.max, 'wider preview must leave less headroom').toBeLessThan(zoomed.max);
    expect(after.scale, `zoom must follow the shrunken budget (max ${after.max})`)
      .toBeLessThanOrEqual(after.max + 0.01);
  });

  test('pinching in never shrinks past fit', async ({ page }) => {
    await touchSequence(page, [
      { type: 'touchstart', points: [[100, 100], [260, 100]] },
      { type: 'touchmove', points: [[170, 100], [190, 100]] },
      { type: 'touchend', points: [[170, 100], [190, 100]] },
    ]);
    expect(await canvasTransform(page), 'scale is clamped at 1').toBe('');
  });

  test('one-finger drag pans while zoomed instead of switching files', async ({ page }) => {
    // Load a second file so a swipe would otherwise navigate, then switch back:
    // rotated.jpg is 16×8 and has no zoom headroom at all.
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'rotated.jpg'));
    await page.waitForFunction(() => document.querySelectorAll('.canvas-wrapper').length === 2);
    await page.locator('.file-list-row').nth(0).click();
    const activeBefore = await page.evaluate(() =>
      document.querySelector('.file-list-row.active-file')?.textContent);

    await touchSequence(page, [
      { type: 'touchstart', points: [[160, 100], [200, 100]] },
      { type: 'touchmove', points: [[100, 100], [260, 100]] },
      { type: 'touchend', points: [[100, 100], [260, 100]] },
    ]);

    const before = await canvasTransform(page);
    await touchSequence(page, [
      { type: 'touchstart', points: [[200, 400]] },
      { type: 'touchmove', points: [[120, 400]] },
      { type: 'touchend', points: [[120, 400]] },
    ]);
    const after = await canvasTransform(page);

    expect(after, 'drag should pan the zoomed canvas').not.toBe(before);
    expect(after, 'drag must not reset the zoom').toContain('scale(');
    const activeAfter = await page.evaluate(() =>
      document.querySelector('.file-list-row.active-file')?.textContent);
    expect(activeAfter, 'panning must not navigate to another file').toBe(activeBefore);
  });
});
