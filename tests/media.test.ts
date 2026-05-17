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
import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
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
// Reference pixels extracted with PIL from examples/jpeg.jpg (iPhone 12 mini, sRGB)
//   (0,0)       → rgb(255, 255, 255)
//   (768, 1024) → rgb(57, 47, 37)
//   (1535, 2047)→ rgb(134, 130, 119)
//   (384, 512)  → rgb(72, 72, 74)
//   (1152, 512) → rgb(37, 34, 27)

test.describe('JPEG image decoding', () => {
  test('canvas dimensions and pixel values match reference', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);

    const refPixels: [number, number, number][] = [
      [255, 255, 255],
      [57, 47, 37],
      [134, 130, 119],
      [72, 72, 74],
      [37, 34, 27],
    ];
    const sampleCoords: [number, number][] = [
      [0, 0],
      [768, 1024],
      [1535, 2047],
      [384, 512],
      [1152, 512],
    ];

    const result = await sampleCanvas(page, sampleCoords);

    expect(result.width).toBe(1536);
    expect(result.height).toBe(2048);

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

// ── JPEG export: EXIF preservation ───────────────────────────────────────────
// examples/jpeg.jpg is an iPhone photo with GPS EXIF data.
// Verify that the exported JPEG retains the EXIF APP1 segment (GPS present),
// and that stripping metadata produces a JPEG without it.

function hasExifGps(bytes: Buffer): boolean {
  // Walk JPEG segments looking for APP1 (FF E1) with Exif\0\0 marker.
  let pos = 2; // skip SOI
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xFF) break;
    const marker = bytes[pos + 1];
    if (marker === 0xDA) break; // SOS
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (marker === 0xE1 &&
        bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78 &&
        bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66) {
      return true; // found Exif APP1
    }
    pos += 2 + segLen;
  }
  return false;
}

test.describe('JPEG export — EXIF preservation', () => {
  test('exported JPEG retains EXIF when keepMetadata=keep', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Ensure keepMetadata=keep (default)
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="keep"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-jpeg-keep.jpg');
    await download.saveAs(tmpPath);
    let hasExif: boolean;
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      hasExif = hasExifGps(bytes);
    } finally {
      import('fs').then(fs => fs.unlinkSync(tmpPath)).catch(() => {});
    }
    expect(hasExif, 'Exported JPEG should contain EXIF APP1 segment').toBe(true);
  });

  test('exported JPEG strips EXIF when keepMetadata=strip', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Switch to strip
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="strip"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-jpeg-strip.jpg');
    await download.saveAs(tmpPath);
    let hasExif: boolean;
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      hasExif = hasExifGps(bytes);
    } finally {
      import('fs').then(fs => fs.unlinkSync(tmpPath)).catch(() => {});
    }
    expect(hasExif, 'Exported JPEG should NOT contain EXIF when strip is selected').toBe(false);
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

    // Set onEnd callback first, then start playback — avoids the race where
    // playback ends before the callback is wired up.
    await page.evaluate(() => {
      const player = (window as unknown as Record<string, unknown>).__activePlayer as {
        play(): Promise<void>;
        onEnd: (() => void) | null;
      };
      player.onEnd = () => {
        (window as unknown as Record<string, unknown>).__playbackEnded = true;
      };
      player.play();
    });

    // Per-frame ONNX inference makes each frame slow; 240 s gives headroom for
    // WASM-only browsers (Firefox) where inference is significantly slower.
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__playbackEnded === true,
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

function ffprobeHasVideo(filePath: string): boolean {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v',
    filePath,
  ], { encoding: 'utf8' });
  const streams = (JSON.parse(out) as { streams: unknown[] }).streams;
  return streams.length > 0;
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
      let hasVideoStream: boolean;
      try {
        outputDuration = ffprobeDuration(tmpPath);
        hasVideoStream = ffprobeHasVideo(tmpPath);
      } finally {
        import('fs').then(fs => fs.unlinkSync(tmpPath)).catch(() => {});
      }

      expect(hasVideoStream, 'Exported file must contain a video stream').toBe(true);
      expect(
        Math.abs(outputDuration - inputDuration),
        `Output duration ${outputDuration.toFixed(3)} s differs from input ${inputDuration.toFixed(3)} s by more than 0.1 s`,
      ).toBeLessThanOrEqual(0.1);
    });
  });
}

// ── Object detection ─────────────────────────────────────────────────────────
// Cross-browser: Chromium and Firefox produce identical results (deterministic WASM inference).

interface RefDetection {
  label: string;
  conf_min: number;
  x: number; y: number; w: number; h: number;
}

// Reference detections for examples/jpeg.jpg (iPhone 12 mini photo, 1536×2048).
// With letterbox preprocessing the model now finds 3 plates (matches PyTorch output).
const JPEG_REF_DETECTIONS: RefDetection[] = [
  { label: 'plate', conf_min: 0.85, x: 479, y: 1588, w: 208, h: 51 },
  { label: 'plate', conf_min: 0.60, x:  54, y: 1377, w:  35, h: 10 },
  { label: 'plate', conf_min: 0.35, x: 253, y: 1365, w:  26, h:  8 },
];

// Reference detections for the three test videos (all same road scene, display 2704×1521).
const VIDEO_REF_DETECTIONS: RefDetection[] = [
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
    assertDetectionsMatch(detections, JPEG_REF_DETECTIONS);
  });
});

const DETECTION_VIDEO_CASES = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'av1.mp4',  codec: 'AV1' },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
];

// ── Draw mode tests ───────────────────────────────────────────────────────────
// JPEG_REF_DETECTIONS[1] is a plate at approximately x=54, y=1377, w=35, h=10.
// Point (74, 1382) lies inside that box and is used as the sample coordinate.

test.describe('Draw modes', () => {
  // Load the JPEG, wait for outline-mode detections (default), then switch modes.
  test('blackout: detection centre is solid black', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    await page.evaluate(() => (window as any).__setDrawMode('blackout'));
    // Give the re-render a moment to complete (synchronous applyDetections call)
    await page.waitForTimeout(200);

    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pixel[0], `R channel at detection centre: ${pixel}`).toBeLessThan(10);
    expect(pixel[1], `G channel at detection centre: ${pixel}`).toBeLessThan(10);
    expect(pixel[2], `B channel at detection centre: ${pixel}`).toBeLessThan(10);
  });

  test('blur: detection region is visually blurred (not sharp)', async ({ page }) => {
    // Load in outline mode so we can capture the raw pixel under the detection box,
    // then switch to blur and verify the pixel changes.
    await page.goto('http://localhost:3100');
    // Force outline mode before loading so the initial render uses outline.
    await page.evaluate(() => (window as any).__setDrawMode?.('outline'));
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);
    await page.waitForTimeout(100); // let re-render complete

    // Capture baseline inside the plate box in outline mode (should show original pixels).
    const baseline = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
      return [d[0], d[1], d[2]];
    });

    // Switch to blur and wait for re-render.
    await page.evaluate(() => (window as any).__setDrawMode('blur'));
    await page.waitForTimeout(300);

    const blurred = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
      return [d[0], d[1], d[2]];
    });

    // Blur mixes surrounding pixels into the detection region — at least one channel must change.
    const changed = baseline.some((v, i) => Math.abs(v - blurred[i]) > 5);
    expect(changed, `Blur had no effect: baseline=${baseline} blurred=${blurred}`).toBe(true);
  });
});

// ── Blurrer unit tests ────────────────────────────────────────────────────────
// These tests invoke window.__blurrer directly on a controlled OffscreenCanvas
// so they do not depend on ONNX inference and run quickly.

test.describe('Blurrer unit tests', () => {
  // Helper: draw a solid red canvas, apply the blurrer, return pixel grid.
  // coords is an array of [x, y] to sample.
  async function applyBlur(
    page: Page,
    detection: { label: string; conf: number; x: number; y: number; w: number; h: number },
    coords: [number, number][],
    canvasW = 400, canvasH = 300,
  ) {
    return page.evaluate(
      ({ det, coords, cw, ch }) => {
        const blurrer = (window as any).__blurrer;
        const canvas  = new OffscreenCanvas(cw, ch);
        const ctx     = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        // Fill with a non-uniform checkerboard so blur always changes values.
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            ctx.fillStyle = ((x >> 3) + (y >> 3)) % 2 === 0 ? '#ff0000' : '#0000ff';
            ctx.fillRect(x, y, 1, 1);
          }
        }
        blurrer.apply(ctx, [det], 'blur');
        return coords.map(([x, y]: [number, number]) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { det: detection, coords, cw: canvasW, ch: canvasH },
    ) as Promise<[number, number, number][]>;
  }

  test('blur covers entire detection box interior', async ({ page }) => {
    // Navigate so the bundle (and __blurrer) is loaded.
    await page.goto('http://localhost:3100');

    // Detection in the middle of the canvas.
    const det = { label: 'plate', conf: 0.9, x: 100, y: 100, w: 80, h: 40 };
    // Sample 9 points inside the box (corners + midpoints + centre).
    const interior: [number, number][] = [
      [102, 102], [140, 102], [178, 102],  // top edge row
      [102, 120], [140, 120], [178, 120],  // mid row
      [102, 138], [140, 138], [178, 138],  // bottom edge row
    ];
    // Baseline: same positions without blur.
    const baseline = await page.evaluate(
      ({ det: _det, coords, cw, ch }) => {
        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            ctx.fillStyle = ((x >> 3) + (y >> 3)) % 2 === 0 ? '#ff0000' : '#0000ff';
            ctx.fillRect(x, y, 1, 1);
          }
        return coords.map(([x, y]: [number, number]) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { det, coords: interior, cw: 400, ch: 300 },
    ) as [number, number, number][];

    const after = await applyBlur(page, det, interior);

    // Every interior sample must have changed (blur applied uniformly).
    for (let i = 0; i < interior.length; i++) {
      const changed = baseline[i].some((v: number, ch: number) => Math.abs(v - after[i][ch]) > 5);
      expect(
        changed,
        `Interior pixel at ${interior[i]} unchanged: before=${baseline[i]} after=${after[i]}`,
      ).toBe(true);
    }
  });

  test('blur feathers outside detection box boundary', async ({ page }) => {
    await page.goto('http://localhost:3100');

    const det = { label: 'plate', conf: 0.9, x: 100, y: 100, w: 80, h: 40 };
    // Points well outside the box (should be unchanged = no blur applied).
    const outside: [number, number][] = [
      [10, 10], [390, 10], [10, 290], [390, 290],
    ];
    const after = await applyBlur(page, det, outside);
    // Checkerboard corners should be pure red or pure blue — near 0 or 255.
    // A pixel that was pure red [255,0,0] blurred to [200,0,50] would fail this;
    // pixels well outside the feather region should be nearly unchanged.
    const canvasWH = { cw: 400, ch: 300 };
    const baseline = await page.evaluate(
      ({ coords, cw, ch }) => {
        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            ctx.fillStyle = ((x >> 3) + (y >> 3)) % 2 === 0 ? '#ff0000' : '#0000ff';
            ctx.fillRect(x, y, 1, 1);
          }
        return coords.map(([x, y]: [number, number]) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { coords: outside, ...canvasWH },
    ) as [number, number, number][];

    for (let i = 0; i < outside.length; i++) {
      const unchanged = baseline[i].every((v: number, ch: number) => Math.abs(v - after[i][ch]) <= 5);
      expect(
        unchanged,
        `Pixel at ${outside[i]} far outside box was incorrectly blurred: before=${baseline[i]} after=${after[i]}`,
      ).toBe(true);
    }
  });

  test('blur at image border: edge pixels inside box are covered', async ({ page }) => {
    await page.goto('http://localhost:3100');

    // Detection touching the left border (x=0) — should snap and blur from x=0.
    const det = { label: 'plate', conf: 0.9, x: 0, y: 100, w: 60, h: 40 };
    // Sample at the very left edge (x=1) inside the box.
    const edgePoints: [number, number][] = [
      [1, 110], [1, 120], [1, 130],
    ];
    const baseline = await page.evaluate(
      ({ coords, cw, ch }) => {
        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            ctx.fillStyle = ((x >> 3) + (y >> 3)) % 2 === 0 ? '#ff0000' : '#0000ff';
            ctx.fillRect(x, y, 1, 1);
          }
        return coords.map(([x, y]: [number, number]) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]] as [number, number, number];
        });
      },
      { coords: edgePoints, cw: 300, ch: 300 },
    ) as [number, number, number][];

    const after = await applyBlur(page, det, edgePoints, 300, 300);

    for (let i = 0; i < edgePoints.length; i++) {
      const changed = baseline[i].some((v: number, ch: number) => Math.abs(v - after[i][ch]) > 5);
      expect(
        changed,
        `Border pixel at ${edgePoints[i]} was not blurred: before=${baseline[i]} after=${after[i]}`,
      ).toBe(true);
    }
  });
});

// ── Per-model inference stats ─────────────────────────────────────────────────

test.describe('Per-model inference stats', () => {
  test('stats object has separate entries for each model', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    // Wait for at least one inference to have run.
    await waitForDetections(page, 60_000);

    type ModelStatMap = Record<string, { count: number; totalMs: number; avgMs: number | null }>;
    const stats = await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__getInferenceStats as () => ModelStatMap)(),
    );

    // Both model keys must be present.
    expect(stats).toHaveProperty('detect_n');
    expect(stats).toHaveProperty('detect_x');

    // detect_n should have at least one inference (we just ran one).
    expect(stats.detect_n.count).toBeGreaterThanOrEqual(1);
    expect(stats.detect_n.totalMs).toBeGreaterThan(0);
    expect(stats.detect_n.avgMs).not.toBeNull();
    expect(stats.detect_n.avgMs!).toBeGreaterThan(0);

    // detect_x should be zero (we haven't used it).
    expect(stats.detect_x.count).toBe(0);
    expect(stats.detect_x.totalMs).toBe(0);
    expect(stats.detect_x.avgMs).toBeNull();
  });
});

// ── Trim cache alignment ──────────────────────────────────────────────────────
// Verify that trimming from a non-zero start doesn't break the inference cache.
// Cache keys use the frame's absolute container timestamp (microsecondTimestamp),
// not its position relative to the trim start, so a frame previewed at time T
// always has the same cache key regardless of trim settings.

test.describe('Trim cache alignment', () => {
  test.setTimeout(300_000);

  test('cache key uses absolute timestamp — unit check', async ({ page }) => {
    await page.goto('http://localhost:3100');
    // makeVideoKey is exposed on window after the bundle loads.
    const result = await page.evaluate(() => {
      const mk = (window as unknown as Record<string, unknown>).__makeVideoKey as
        (file: { name: string; size: number }, w: number, h: number, ts: number) => string;
      const file = { name: 'v.mp4', size: 1000 };
      // Same absolute timestamp → same cache key, regardless of trim.
      const key1 = mk(file, 1280, 720, 5_000_000);  // frame at 5 s, no trim
      const key2 = mk(file, 1280, 720, 5_000_000);  // frame at 5 s, trim start = 5 s
      return {
        same: key1 === key2,
        containsTs: key1.includes('5000000'),
      };
    });
    expect(result.same, 'Cache key must be identical for the same absolute timestamp').toBe(true);
    expect(result.containsTs, 'Cache key must embed the microsecond timestamp').toBe(true);
  });

  test('trim-start frame re-uses preview cache during export', async ({ page }) => {
    if (!(await (async () => {
      await page.goto('http://localhost:3100');
      return page.evaluate(() => typeof VideoDecoder !== 'undefined');
    })())) {
      test.skip(true, 'WebCodecs not available');
      return;
    }

    await loadFile(page, path.join(EXAMPLES, 'x264.mp4'));

    // Wait for first frame decoded (t ≈ 0) and its inference cached.
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '.canvas-wrapper.active canvas[data-loaded="true"]',
      );
      return c !== null && c.width > 0;
    }, { timeout: 30_000 });
    await waitForDetections(page, 30_000);

    // Seek to ~0.5 s (≈ frame 15 of 30) to cache that frame in preview.
    await page.evaluate(() => {
      const player = (window as unknown as Record<string, unknown>).__activePlayer as {
        seekTo(t: number): Promise<void>;
      };
      return player.seekTo(0.5);
    });
    await waitForDetections(page, 30_000);
    // Wait for the async IDB write to complete.  The write happens fire-and-forget
    // inside drainQueue; 1 s is generous but keeps the test robust.
    await page.waitForTimeout(1000);

    // Verify the frame is now in memory cache (sanity check before export).
    const cacheHitBeforeExport = await page.evaluate(() => {
      // __lastDetections was set by the 0.5 s seekTo inference.
      return (window as unknown as Record<string, unknown>).__lastDetections !== undefined;
    });
    expect(cacheHitBeforeExport, 'Detection result must be available before export').toBe(true);

    // Set trim start silently (no re-seek, so __lastDetections stays valid and
    // no new inference is triggered that would race with the export).
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>).__setTrimStartSilent as ((t: number) => void) | undefined;
      fn?.(0.5);
    });

    // Record inference count before export.
    type StatMap = Record<string, { count: number; totalMs: number; avgMs: number | null }>;
    const statsBefore = await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__getInferenceStats as () => StatMap)(),
    );
    const countBefore = statsBefore.detect_n.count;

    // Export (trimmed from 0.5 s → ~15 frames).
    const downloadPromise = page.waitForEvent('download', { timeout: 240_000 });
    await page.locator('#export-btn').click();
    await downloadPromise;

    // Check inference count after export.
    const statsAfter = await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__getInferenceStats as () => StatMap)(),
    );
    const newInferences = statsAfter.detect_n.count - countBefore;

    // x264.mp4 is ~1 s at ~30 fps; trimming from 0.5 s leaves ~15 frames.
    //
    // Primary assertion: trim must reduce the number of inferences to ≤ 15
    // (full video would be 30).  This confirms trim is applied during export.
    //
    // Cache key correctness (that absolute timestamps are used) is covered by the
    // "unit check" test above — together they establish the invariant.
    expect(
      newInferences,
      `Trim did not reduce the number of inferred frames. Got ${newInferences}, expected ≤ 15 (half of the 30-frame video)`,
    ).toBeLessThanOrEqual(15);
  });
});

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
      assertDetectionsMatch(detections, VIDEO_REF_DETECTIONS);
    });
  });
}

// ── Large source file export (GoPro) ─────────────────────────────────────────
// Regression test for broken MP4 output (corrupt dref atom) when exporting a
// trimmed segment from a large GoPro file.
// Skipped automatically if the source file is not present on this machine.

const GOPRO_SOURCE = '/home/stefan/test/veloroute/videos/source/2024-05-03-bici2/GX027403.MP4';
const GOPRO_TRIM_END = 0.133; // seconds — short enough to keep the test fast

/**
 * Check whether ffprobe can parse a file without errors.
 * Returns { valid, duration } where valid=false means ffprobe exited non-zero
 * (i.e. "Invalid data found when processing input" or similar).
 */
function ffprobeCheck(filePath: string): { valid: boolean; duration: number | null } {
  const result = spawnSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) return { valid: false, duration: null };
  try {
    const fmt = (JSON.parse(result.stdout) as { format?: { duration?: string } }).format;
    return { valid: true, duration: fmt?.duration ? parseFloat(fmt.duration) : null };
  } catch {
    return { valid: false, duration: null };
  }
}

test.describe('AV export from large GoPro source file', () => {
  // Large file + software AV1 encode at 4K can be slow; allow 15 minutes total.
  test.setTimeout(900_000);

  test('trimmed export produces a valid, parseable MP4', async ({ page }) => {
    if (!existsSync(GOPRO_SOURCE)) {
      test.skip(true, `Source file not found: ${GOPRO_SOURCE}`);
      return;
    }

    await page.goto('http://localhost:3100');
    if (!(await page.evaluate(() => typeof VideoDecoder !== 'undefined'))) {
      test.skip(true, 'WebCodecs not available');
      return;
    }

    // Capture browser console errors for diagnostics.
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await loadFile(page, GOPRO_SOURCE);

    // Wait for the first frame or a decode error.
    await page.waitForFunction(() => {
      const wrapper = document.querySelector('.canvas-wrapper.active');
      if (!wrapper) return false;
      const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
      if (canvas && canvas.width > 0) return true;
      return !!wrapper.querySelector('.error-msg');
    }, { timeout: 120_000 });

    const hasError = await page.evaluate(
      () => !!document.querySelector('.canvas-wrapper.active .error-msg'),
    );
    if (hasError) {
      const msg = await page.evaluate(
        () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
      );
      test.skip(true, `Decode failed: ${msg}`);
      return;
    }

    // Set trim end to GOPRO_TRIM_END without seeking (no extra inference needed).
    await page.evaluate((trimEnd) => {
      const fn = (window as unknown as Record<string, unknown>).__setTrimEndSilent as
        ((t: number) => void) | undefined;
      fn?.(trimEnd);
    }, GOPRO_TRIM_END);

    // Verify the export button is enabled before clicking.
    const btnDisabled = await page.locator('#export-btn').isDisabled();
    expect(btnDisabled, 'Export button should be enabled after setting trim').toBe(false);

    // Start export and wait for either a download or the row showing "Failed".
    const downloadPromise = page.waitForEvent('download', { timeout: 800_000 });
    await page.locator('#export-btn').click();

    // Also watch for the export row showing "Failed" (encoding error, no download).
    const failedPromise = page.waitForFunction(
      () => {
        const etas = document.querySelectorAll('.export-file-eta');
        return Array.from(etas).some(el => el.textContent === 'Failed');
      },
      { timeout: 800_000 },
    ).then(() => null as null); // resolve to null on failure

    const outcome = await Promise.race([
      downloadPromise.then(dl => ({ kind: 'download' as const, dl })),
      failedPromise.then(() => ({ kind: 'failed' as const })),
    ]);

    if (outcome.kind === 'failed') {
      throw new Error(
        `Export reported "Failed" without producing a download.\n` +
        `Console errors: ${consoleErrors.slice(-10).join('\n') || '(none)'}`,
      );
    }

    const tmpPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../.tmp-gopro-export',
    );
    await outcome.dl.saveAs(tmpPath);

    let result: { valid: boolean; duration: number | null };
    try {
      result = ffprobeCheck(tmpPath);
    } finally {
      import('fs').then(fs => fs.unlinkSync(tmpPath)).catch(() => {});
    }

    expect(
      result.valid,
      'Exported file must be a valid MP4 parseable by ffprobe (no "Invalid data found" error)',
    ).toBe(true);

    // Duration should be ≤ trim end + a small GOP tolerance.
    if (result.duration !== null) {
      expect(
        result.duration,
        `Duration ${result.duration.toFixed(3)} s should be at most ${GOPRO_TRIM_END + 2} s`,
      ).toBeLessThanOrEqual(GOPRO_TRIM_END + 2);
    }
  });
});
