/**
 * Tests for preview navigation: swipe, keyboard arrows, chevron buttons,
 * chevron visibility at boundaries, and no-wrap behavior.
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.join(__dirname, '..', 'examples');

async function loadMultipleFiles(page: Page) {
  await page.goto('http://localhost:3100');
  await page.locator('#file-input').setInputFiles([
    path.join(EXAMPLES, 'jpeg.jpg'),
    path.join(EXAMPLES, 'x264.mp4'),
    path.join(EXAMPLES, 'av1.mp4'),
  ]);
  // Wait for first file to be loaded
  await page.waitForFunction(
    () => document.querySelector('.canvas-wrapper.active canvas[data-loaded="true"]') !== null,
    { timeout: 30_000 },
  );
}

function getActiveFileName(page: Page) {
  return page.evaluate(() => document.querySelector('.file-list-row.active-file .file-list-name')?.textContent ?? '');
}

test.describe('Preview navigation', () => {
  test('arrow keys navigate between files without wrapping', async ({ page }) => {
    await loadMultipleFiles(page);

    // Should start at first file
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    // ArrowRight → next
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('x264.mp4');

    // ArrowRight → next
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('av1.mp4');

    // ArrowRight at last → stays (no wrap)
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('av1.mp4');

    // ArrowLeft → previous
    await page.keyboard.press('ArrowLeft');
    expect(await getActiveFileName(page)).toBe('x264.mp4');

    // Go back to first
    await page.keyboard.press('ArrowLeft');
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    // ArrowLeft at first → stays (no wrap)
    await page.keyboard.press('ArrowLeft');
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');
  });

  test('arrow keys are ignored when input is focused', async ({ page }) => {
    await loadMultipleFiles(page);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    // Focus a text input
    await page.locator('#naming-pattern-input').focus();
    await page.keyboard.press('ArrowRight');

    // Should not navigate
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');
  });

  test('chevron buttons navigate between files', async ({ page }) => {
    await loadMultipleFiles(page);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    // Click next chevron
    await page.locator('.preview-nav-next').click({ force: true });
    expect(await getActiveFileName(page)).toBe('x264.mp4');

    // Click prev chevron
    await page.locator('.preview-nav-prev').click({ force: true });
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');
  });

  test('prev chevron is hidden on first file, next hidden on last', async ({ page }) => {
    await loadMultipleFiles(page);

    // On first file: prev hidden, next visible
    expect(await page.locator('.preview-nav-prev').isHidden()).toBe(true);
    expect(await page.locator('.preview-nav-next').isHidden()).toBe(false);

    // Navigate to last
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('av1.mp4');

    // On last file: prev visible, next hidden
    expect(await page.locator('.preview-nav-prev').isHidden()).toBe(false);
    expect(await page.locator('.preview-nav-next').isHidden()).toBe(true);

    // Navigate to middle
    await page.keyboard.press('ArrowLeft');
    expect(await getActiveFileName(page)).toBe('x264.mp4');

    // In middle: both visible
    expect(await page.locator('.preview-nav-prev').isHidden()).toBe(false);
    expect(await page.locator('.preview-nav-next').isHidden()).toBe(false);
  });

  test('chevrons hidden when only one file is loaded', async ({ page }) => {
    await page.goto('http://localhost:3100');
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await page.waitForFunction(
      () => document.querySelector('.canvas-wrapper.active canvas[data-loaded="true"]') !== null,
      { timeout: 30_000 },
    );

    expect(await page.locator('.preview-nav-prev').isHidden()).toBe(true);
    expect(await page.locator('.preview-nav-next').isHidden()).toBe(true);
  });

  test('swipe left navigates to next file', async ({ page }) => {
    await loadMultipleFiles(page);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    const area = page.locator('#preview-area');
    const box = (await area.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Simulate swipe left (start center, move left by 80px)
    await swipe(page, centerX, centerY, centerX - 80, centerY);

    expect(await getActiveFileName(page)).toBe('x264.mp4');
  });

  test('swipe right navigates to previous file', async ({ page }) => {
    await loadMultipleFiles(page);
    // Go to second file first
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('x264.mp4');

    const area = page.locator('#preview-area');
    const box = (await area.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Simulate swipe right
    await swipe(page, centerX, centerY, centerX + 80, centerY);

    expect(await getActiveFileName(page)).toBe('jpeg.jpg');
  });

  test('swipe does not wrap at boundaries', async ({ page }) => {
    await loadMultipleFiles(page);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    const area = page.locator('#preview-area');
    const box = (await area.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Swipe right on first file → should stay
    await swipe(page, centerX, centerY, centerX + 80, centerY);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    // Go to last file
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await getActiveFileName(page)).toBe('av1.mp4');

    // Swipe left on last file → should stay
    await swipe(page, centerX, centerY, centerX - 80, centerY);
    expect(await getActiveFileName(page)).toBe('av1.mp4');
  });

  test('short swipe does not navigate', async ({ page }) => {
    await loadMultipleFiles(page);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');

    const area = page.locator('#preview-area');
    const box = (await area.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Swipe left only 30px (below 50px threshold)
    await swipe(page, centerX, centerY, centerX - 30, centerY);
    expect(await getActiveFileName(page)).toBe('jpeg.jpg');
  });
});

/** Simulate a touch swipe from (x1,y1) to (x2,y2). */
async function swipe(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.evaluate(
    ([x1, y1, x2, y2]) => {
      const el = document.getElementById('preview-area')!;
      const touch = (x: number, y: number) => new Touch({
        identifier: 0,
        target: el,
        clientX: x,
        clientY: y,
      });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [touch(x1, y1)],
        changedTouches: [touch(x1, y1)],
        bubbles: true,
      }));
      el.dispatchEvent(new TouchEvent('touchmove', {
        touches: [touch(x2, y2)],
        changedTouches: [touch(x2, y2)],
        bubbles: true,
      }));
      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [],
        changedTouches: [touch(x2, y2)],
        bubbles: true,
      }));
    },
    [x1, y1, x2, y2] as const,
  );
}
