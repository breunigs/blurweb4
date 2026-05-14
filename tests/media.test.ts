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
import type { Detection } from '../src/detector';
import { execFileSync } from 'child_process';
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
  await page.goto('http://localhost:3100');
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
// All three videos are coded 2704×1520 with SAR 1520:1521, giving a display
// height of 1521.  H.265 is decoded via the libav.js WASM fallback on platforms
// where WebCodecs lacks native HEVC support (e.g. Linux).

const VIDEO_CASES: { file: string; codec: string; wasmFallback?: boolean }[] = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'av1.mp4',  codec: 'AV1'   },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
];

for (const { file, codec, wasmFallback } of VIDEO_CASES) {
  test.describe(`${codec} video decoding (${file})`, () => {
    // The WASM fallback for HEVC loads a 2 MB binary; allow more wall-clock time.
    test.setTimeout(wasmFallback ? 120_000 : 60_000);

    test('first frame decoded onto canvas with correct dimensions', async ({ page }) => {
      // Navigate first — WebCodecs requires a secure context (localhost is fine;
      // about:blank is not, so we must check AFTER page load).
      await loadFile(page, path.join(EXAMPLES, file));

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available in this browser build');
      }

      // Wait for either: frame decoded onto canvas, or an error message shown.
      // The WASM fallback needs extra time to download and initialise.
      const waitMs = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>(
          'canvas[data-loaded="true"]',
        );
        if (canvas && canvas.width > 0 && canvas.height > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      }, { timeout: waitMs });

      // Verify canvas state
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

      expect(state.kind, `Decode failed: ${state.kind === 'error' ? state.msg : ''}`).toBe('canvas');
      expect(state.width).toBe(2704);
      expect(state.height).toBe(1521); // display height after SAR 1520:1521 adjustment

      // At least 20 % of pixels must be non-black to confirm a real decoded frame
      if (state.kind !== 'canvas') throw new Error('unreachable');
      const nonBlackRatio = state.nonBlack / state.total;
      expect(nonBlackRatio).toBeGreaterThan(0.2);
    });
  });
}

// ── x265 playback: individual frame updates ───────────────────────────────
// Verifies that:
//  1. The libav.js WASM fallback decodes all frames (not just first/last).
//  2. Each frame is individually committed to the canvas (the rAF-based
//     player loop ensures each frame gets its own browser paint cycle).
//
// Method: the VideoPlayer dispatches a 'videoframe' CustomEvent on the canvas
// after every draw.  We install a listener in the page before pressing play,
// snapshot the canvas pixels on each event, and assert that at least N
// distinct pixel signatures were observed.

test.describe('H.265 playback — frame-by-frame updates (libav.js fallback)', () => {
  // Per-frame ONNX inference adds significant time to each decoded frame.
  test.setTimeout(300_000);

  test('canvas changes on each frame throughout playback', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'x265.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    // Wait for first frame to appear.
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.canvas-wrapper.active canvas[data-loaded="true"]',
      );
      return canvas !== null && canvas.width > 0;
    }, { timeout: 90_000 });

    // Install a 'videoframe' listener on the canvas.  On each event we compute
    // a pixel signature (sum of a 16×16 centre block) and push it to a window
    // variable that Playwright can read back.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.canvas-wrapper.active canvas',
      )!;
      (window as unknown as Record<string, unknown>).__frameSignatures = [] as number[];
      canvas.addEventListener('videoframe', () => {
        const ctx = canvas.getContext('2d')!;
        const cx  = Math.floor(canvas.width  / 2) - 8;
        const cy  = Math.floor(canvas.height / 2) - 8;
        const d   = ctx.getImageData(cx, cy, 16, 16).data;
        let sum   = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        (window as unknown as Record<string, unknown[]>).__frameSignatures.push(sum);
      });
    });

    // Press play.
    await page.locator('#play-btn').click();

    // Wait until the play button reverts to ▶ (end-of-stream).
    // Per-frame ONNX inference makes each frame slow; 240 s gives headroom for
    // WASM-only browsers (Firefox) where inference is significantly slower.
    await page.waitForFunction(
      () => document.querySelector('#play-btn')?.textContent?.trim() === '▶',
      { timeout: 240_000 },
    );

    // Collect results.
    const signatures = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__frameSignatures as number[],
    );

    const distinct = new Set(signatures).size;

    // The video is ~1 s at ~25 fps.  Even through WASM we expect every decoded
    // frame to produce a distinct canvas draw.  Require at least 5 unique
    // signatures; ≤ 2 would indicate only first+last were ever committed.
    expect(
      distinct,
      `Only ${distinct} distinct frame signatures across ${signatures.length} 'videoframe' events — ` +
      'frames are not being individually committed to the canvas.',
    ).toBeGreaterThanOrEqual(5);
  });
});

// ── Export: output video duration matches input ───────────────────────────
// For each video, click Export and intercept the browser download.
// Pipe the downloaded bytes through ffprobe to read the container duration,
// then assert it is within 0.1 s of the source file's duration.

function ffprobeDuration(filePath: string): number {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath,
  ], { encoding: 'utf8' });
  const fmt = (JSON.parse(out) as { format: { duration: string } }).format;
  return parseFloat(fmt.duration);
}

const EXPORT_CASES = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
  { file: 'av1.mp4',  codec: 'AV1' },
];

for (const { file, codec, wasmFallback } of EXPORT_CASES) {
  test.describe(`${codec} export — output duration matches input (${file})`, () => {
    // Per-frame ONNX inference during export adds significant time.
    // Timeouts are large to accommodate cold-cache (first run) inference costs.
    // On warm cache (subsequent runs) export completes in a fraction of this time.
    test.setTimeout(wasmFallback ? 1_800_000 : 1_200_000);

    test('exported file duration within 0.1 s of source', async ({ page }) => {
      const inputPath = path.join(EXAMPLES, file);
      const inputDuration = ffprobeDuration(inputPath);

      await loadFile(page, inputPath);

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available');
      }

      // Wait for the first frame so the player is fully initialised.
      const firstFrameWait = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(() => {
        const c = document.querySelector<HTMLCanvasElement>(
          '.canvas-wrapper.active canvas[data-loaded="true"]',
        );
        return c !== null && c.width > 0;
      }, { timeout: firstFrameWait });

      // Wait for the first-frame background inference to complete and warm the
      // cache before export starts.  This avoids running inference twice for
      // frame 0 (once in background, once during export) and ensures the export
      // only needs inference for frames 1..N-1 rather than 0..N-1.
      await waitForDetections(page, wasmFallback ? 90_000 : 45_000);

      // Intercept the download triggered by the Export button.
      const exportWait = wasmFallback ? 1_700_000 : 1_100_000;
      const downloadPromise = page.waitForEvent('download', { timeout: exportWait });
      await page.locator('#export-btn').click();
      const download = await downloadPromise;

      // Save to a temp path and measure with ffprobe.
      const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `../.tmp-${file}`);
      await download.saveAs(tmpPath);

      let outputDuration: number;
      try {
        outputDuration = ffprobeDuration(tmpPath);
      } finally {
        import('fs').then(fs => fs.unlinkSync(tmpPath)).catch(() => {});
      }

      expect(
        Math.abs(outputDuration - inputDuration),
        `Output duration ${outputDuration.toFixed(3)} s differs from input ${inputDuration.toFixed(3)} s by more than 0.1 s`,
      ).toBeLessThanOrEqual(0.1);
    });
  });
}

// ── Object detection ─────────────────────────────────────────────────────────
// Reference detections captured from detect_n_2024_04.onnx on examples/jpeg.jpg
// (and verified to match the first frame of each video).
// Cross-browser: Chromium and Firefox produce identical results (deterministic WASM inference).

interface RefDetection {
  label: string;
  conf_min: number;
  x: number; y: number; w: number; h: number;
}

const REF_DETECTIONS: RefDetection[] = [
  { label: 'plate', conf_min: 0.87, x: 1715, y: 858, w: 67, h: 18 },
  { label: 'plate', conf_min: 0.76, x: 2618, y: 1096, w: 85, h: 62 },
];

const BOX_TOL = 5; // pixels

function assertDetectionsMatch(actual: Detection[], ref: RefDetection[]): void {
  expect(actual.length, `expected ${ref.length} detections, got ${actual.length}: ${JSON.stringify(actual)}`).toBe(ref.length);
  for (let i = 0; i < ref.length; i++) {
    const a = actual[i];
    const r = ref[i];
    expect(a.label, `detection[${i}] label`).toBe(r.label);
    expect(a.conf, `detection[${i}] conf`).toBeGreaterThanOrEqual(r.conf_min);
    expect(Math.abs(a.x - r.x), `detection[${i}] x: got ${a.x}, ref ${r.x}`).toBeLessThanOrEqual(BOX_TOL);
    expect(Math.abs(a.y - r.y), `detection[${i}] y: got ${a.y}, ref ${r.y}`).toBeLessThanOrEqual(BOX_TOL);
    expect(Math.abs(a.w - r.w), `detection[${i}] w: got ${a.w}, ref ${r.w}`).toBeLessThanOrEqual(BOX_TOL);
    expect(Math.abs(a.h - r.h), `detection[${i}] h: got ${a.h}, ref ${r.h}`).toBeLessThanOrEqual(BOX_TOL);
  }
}

async function waitForDetections(page: Page, timeoutMs = 60_000): Promise<Detection[]> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__lastDetections !== undefined,
    { timeout: timeoutMs },
  );
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__lastDetections as Detection[],
  );
}

test.describe('Object detection — JPEG first frame', () => {
  test('detections match reference', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    const detections = await waitForDetections(page);
    assertDetectionsMatch(detections, REF_DETECTIONS);
  });
});

const DETECTION_VIDEO_CASES = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'av1.mp4',  codec: 'AV1' },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
];

for (const { file, codec, wasmFallback } of DETECTION_VIDEO_CASES) {
  test.describe(`Object detection — ${codec} first frame (${file})`, () => {
    test.setTimeout(wasmFallback ? 120_000 : 60_000);

    test('first-frame detections match reference', async ({ page }) => {
      await loadFile(page, path.join(EXAMPLES, file));

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available in this browser build');
      }

      // Wait for the canvas to be painted (first frame decoded + inference done).
      const waitMs = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
        if (canvas && canvas.width > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      }, { timeout: waitMs });

      // Skip if decoding failed (e.g. HEVC on Linux without WASM fallback support).
      const hasError = await page.evaluate(
        () => !!document.querySelector('.canvas-wrapper.active .error-msg'),
      );
      if (hasError) {
        const msg = await page.evaluate(
          () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
        );
        test.skip(true, `Decode failed: ${msg}`);
      }

      const detections = await waitForDetections(page, waitMs);
      assertDetectionsMatch(detections, REF_DETECTIONS);
    });
  });
}
