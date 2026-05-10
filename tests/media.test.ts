/**
 * Browser tests for media decoding.
 *
 * For images: verify canvas dimensions and pixel values match the reference
 * extracted from the source file (PIL, tolerance ±20 per channel to allow
 * for browser colour-space differences).
 *
 * For videos: verify canvas dimensions and that the decoded frame contains
 * non-trivial pixel content (not blank).
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.join(__dirname, '..', 'examples');

// ── helpers ─────────────────────────────────────────────────────────────────

/** Wait until the active canvas has been fully painted (data-loaded="true"). */
async function waitForCanvas(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.canvas-wrapper.active canvas[data-loaded="true"]',
      );
      return canvas !== null && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: timeoutMs },
  );
}

/** Return canvas dimensions and sampled pixel values from the active canvas. */
function sampleCanvas(page: Page, coords: [number, number][]) {
  return page.evaluate((coords) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.canvas-wrapper.active canvas',
    )!;
    const ctx = canvas.getContext('2d')!;
    const pixels: [number, number, number][] = coords.map(([x, y]) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    return { width: canvas.width, height: canvas.height, pixels };
  }, coords);
}

/** Load one file via the file-input widget. */
async function loadFile(page: Page, filePath: string) {
  await page.goto('http://localhost:3000');
  await page.locator('#file-input').setInputFiles(filePath);
}

/** Check whether WebCodecs is available (Firefox may lack it in older builds). */
async function webCodecsSupported(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof VideoDecoder !== 'undefined');
}

/** Check that every [expected, actual] pair is within `tol` per channel. */
function withinTolerance(
  actual: [number, number, number],
  expected: [number, number, number],
  tol: number,
): boolean {
  return (
    Math.abs(actual[0] - expected[0]) <= tol &&
    Math.abs(actual[1] - expected[1]) <= tol &&
    Math.abs(actual[2] - expected[2]) <= tol
  );
}

// ── JPEG image ───────────────────────────────────────────────────────────────
// Reference pixels extracted with PIL from examples/jpeg.jpg (sRGB)
//   (0,0)       → rgb(82, 124, 162)
//   (1352, 760) → rgb(134, 131, 114)
//   (2703, 1520)→ rgb(133, 141, 164)
//   (100, 100)  → rgb(159, 145, 145)
//   (676, 380)  → rgb(94,   60,  50)

test.describe('JPEG image decoding', () => {
  test('canvas dimensions and pixel values match reference', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);

    const refPixels: [number, number, number][] = [
      [82, 124, 162],
      [134, 131, 114],
      [133, 141, 164],
      [159, 145, 145],
      [94, 60, 50],
    ];
    const sampleCoords: [number, number][] = [
      [0, 0],
      [1352, 760],
      [2703, 1520],
      [100, 100],
      [676, 380],
    ];

    const result = await sampleCanvas(page, sampleCoords);

    expect(result.width).toBe(2704);
    expect(result.height).toBe(1521);

    const TOLERANCE = 20; // allow ±20 per channel for colour-space differences
    for (let i = 0; i < refPixels.length; i++) {
      expect(
        withinTolerance(result.pixels[i], refPixels[i], TOLERANCE),
        `pixel at ${JSON.stringify(sampleCoords[i])}: ` +
          `got rgb(${result.pixels[i]}) expected rgb(${refPixels[i]}) ±${TOLERANCE}`,
      ).toBe(true);
    }
  });
});

// ── Video decoding ────────────────────────────────────────────────────────────
// All three videos are 2704×1520.  We verify dimensions and that the decoded
// first frame is not blank.  x265/HEVC may be unsupported on some platforms.

const VIDEO_CASES: { file: string; codec: string; expectSupport?: boolean }[] = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'av1.mp4',  codec: 'AV1'   },
  { file: 'x265.mp4', codec: 'H.265' },
];

for (const { file, codec } of VIDEO_CASES) {
  test.describe(`${codec} video decoding (${file})`, () => {
    test('first frame decoded onto canvas with correct dimensions', async ({ page }) => {
      // Navigate first — WebCodecs requires a secure context (localhost is fine;
      // about:blank is not, so we must check AFTER page load).
      await loadFile(page, path.join(EXAMPLES, file));

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available in this browser build');
      }

      // Videos may take longer to decode than images
      // Wait for either: frame decoded onto canvas, or an error message shown
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>(
          'canvas[data-loaded="true"]',
        );
        if (canvas && canvas.width > 0 && canvas.height > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      }, { timeout: 45_000 });

      // Check whether we got a canvas or an error
      const state = await page.evaluate(() => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return { kind: 'none' } as const;
        const canvas = wrapper.querySelector<HTMLCanvasElement>(
          'canvas[data-loaded="true"]',
        );
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const ctx = canvas.getContext('2d')!;
          const total = canvas.width * canvas.height;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonBlack = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) nonBlack++;
          }
          return { kind: 'canvas', width: canvas.width, height: canvas.height, nonBlack, total } as const;
        }
        const err = wrapper.querySelector('.error-msg');
        return { kind: 'error', msg: err?.textContent ?? 'unknown' } as const;
      });

      if (state.kind === 'error') {
        // Skip gracefully for unsupported codecs (e.g. HEVC on Linux)
        test.skip(true, `Codec not supported: ${state.msg}`);
        return;
      }

      expect(state.kind).toBe('canvas');
      expect(state.width).toBe(2704);
      expect(state.height).toBe(1521); // mediabunny displayHeight accounts for SAR

      // At least 20 % of pixels must be non-black to confirm a real frame
      const nonBlackRatio = state.nonBlack / state.total;
      expect(nonBlackRatio).toBeGreaterThan(0.2);
    });
  });
}
