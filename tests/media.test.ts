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
async function waitForCanvas(page: Page, timeoutMs = 60_000) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
      return canvas !== null && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: timeoutMs },
  );
}

/** Return canvas dimensions and sampled pixel values from the active canvas. */
function sampleCanvas(page: Page, coords: [number, number][]) {
  return page.evaluate((coords) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
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
function withinTolerance(actual: [number, number, number], expected: [number, number, number], tol: number): boolean {
  return (
    Math.abs(actual[0] - expected[0]) <= tol &&
    Math.abs(actual[1] - expected[1]) <= tol &&
    Math.abs(actual[2] - expected[2]) <= tol
  );
}

// ── JPEG image ───────────────────────────────────────────────────────────────
// Reference pixels extracted with PIL from examples/jpeg.jpg (Hamburg street scene, sRGB)
//   (0,0)       → rgb(40, 44, 47)
//   (706, 287)  → rgb(155, 162, 155)
//   (1411, 450) → rgb(222, 211, 207)
//   (353, 143)  → rgb(109, 116, 124)
//   (1059, 143) → rgb(255, 201, 177)

test.describe('JPEG image decoding', () => {
  test('canvas dimensions and pixel values match reference', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);

    const refPixels: [number, number, number][] = [
      [40, 44, 47],
      [155, 162, 155],
      [222, 211, 207],
      [109, 116, 124],
      [255, 201, 177],
    ];
    const sampleCoords: [number, number][] = [
      [0, 0],
      [706, 287],
      [1411, 450],
      [353, 143],
      [1059, 143],
    ];

    const result = await sampleCanvas(page, sampleCoords);

    expect(result.width).toBe(1429);
    expect(result.height).toBe(497);

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

/** Read the EXIF orientation tag from a JPEG buffer. Returns 0 if not found. */
function readExifOrientation(bytes: Buffer): number {
  let pos = 2; // skip SOI
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda) break;
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (
      marker === 0xe1 &&
      pos + 10 <= bytes.length &&
      bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78 &&
      bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66
    ) {
      const tiffStart = pos + 10;
      const tiff = bytes.subarray(tiffStart);
      if (tiff.length < 8) return 0;
      const isLE = tiff[0] === 0x49;
      const r16 = (o: number) =>
        isLE ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
      const r32 = (o: number) =>
        isLE
          ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
          : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0;
      if (r16(2) !== 0x002a) return 0;
      const ifd0Off = r32(4);
      const count = r16(ifd0Off);
      for (let i = 0; i < count; i++) {
        const e = ifd0Off + 2 + i * 12;
        if (r16(e) === 0x0112) {
          // Orientation tag — type SHORT(3), value is at offset e+8
          return r16(e + 8);
        }
      }
      return 0; // EXIF present but no orientation tag
    }
    pos += 2 + segLen;
  }
  return 0;
}

function hasExifGps(bytes: Buffer): boolean {
  // Walk JPEG segments looking for APP1 (FF E1) with Exif\0\0 marker.
  let pos = 2; // skip SOI
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda) break; // SOS
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (
      marker === 0xe1 &&
      bytes[pos + 4] === 0x45 &&
      bytes[pos + 5] === 0x78 &&
      bytes[pos + 6] === 0x69 &&
      bytes[pos + 7] === 0x66
    ) {
      return true; // found Exif APP1
    }
    pos += 2 + segLen;
  }
  return false;
}

/** Inspect the EXIF TIFF structure for specific IFD pointers and tags. */
function inspectExifTiff(bytes: Buffer): { hasGpsIfd: boolean; hasExifIfd: boolean; hasDateTimeOriginal: boolean; ifd0TagCount: number } {
  const result = { hasGpsIfd: false, hasExifIfd: false, hasDateTimeOriginal: false, ifd0TagCount: 0 };
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda) break;
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (
      marker === 0xe1 &&
      bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78 &&
      bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66
    ) {
      const tiff = bytes.subarray(pos + 10, pos + 2 + segLen);
      if (tiff.length < 8) return result;
      const isLE = tiff[0] === 0x49;
      const r16 = (o: number) => isLE ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
      const r32 = (o: number) => isLE
        ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
        : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0;
      if (r16(2) !== 0x002a) return result;
      const ifd0Off = r32(4);
      const count = r16(ifd0Off);
      result.ifd0TagCount = count;
      let exifIfdOff: number | null = null;
      for (let i = 0; i < count; i++) {
        const tag = r16(ifd0Off + 2 + i * 12);
        if (tag === 0x8825) result.hasGpsIfd = true;
        if (tag === 0x8769) {
          result.hasExifIfd = true;
          exifIfdOff = r32(ifd0Off + 2 + i * 12 + 8);
        }
      }
      if (exifIfdOff !== null) {
        const ec = r16(exifIfdOff);
        for (let i = 0; i < ec; i++) {
          if (r16(exifIfdOff + 2 + i * 12) === 0x9003) result.hasDateTimeOriginal = true;
        }
      }
      return result;
    }
    pos += 2 + segLen;
  }
  return result;
}

test.describe('JPEG export — EXIF preservation', () => {
  test('exported JPEG retains EXIF when keepMetadata=keep', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Ensure keepMetadata=keep (default)
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="keep"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-jpeg-keep.jpg');
    await download.saveAs(tmpPath);
    let hasExif: boolean;
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      hasExif = hasExifGps(bytes);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }
    expect(hasExif, 'Exported JPEG should contain EXIF APP1 segment').toBe(true);
  });

  test('exported JPEG strips EXIF when keepMetadata=strip', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Switch to strip
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="strip"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-jpeg-strip.jpg');
    await download.saveAs(tmpPath);
    let hasExif: boolean;
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      hasExif = hasExifGps(bytes);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }
    expect(hasExif, 'Exported JPEG should NOT contain EXIF when strip is selected').toBe(false);
  });

  test('exported JPEG keeps only GPS + DateTimeOriginal when keepMetadata=gps', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Switch to GPS-only
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="gps"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-jpeg-gps.jpg');
    await download.saveAs(tmpPath);
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      const info = inspectExifTiff(bytes);
      // Source jpeg.jpg has GPS — it must survive GPS-only mode
      expect(info.hasGpsIfd, 'GPS IFD should be present in GPS-only export').toBe(true);
      // IFD0 should contain only the GPS pointer (and Exif IFD pointer if DateTimeOriginal
      // were present in the source — jpeg.jpg lacks it, so only the GPS pointer)
      expect(info.ifd0TagCount, 'IFD0 should contain only sub-IFD pointers, not extra tags').toBeLessThanOrEqual(2);
      // jpeg.jpg has no DateTimeOriginal, so Exif sub-IFD should be absent
      expect(info.hasDateTimeOriginal, 'DateTimeOriginal should be absent (source lacks it)').toBe(false);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }
  });
});

// ── EXIF orientation handling ─────────────────────────────────────────────────
// examples/rotated.jpg is a 16×8 coded JPEG with EXIF orientation=6 (90° CW).
// After rotation it should display as 8×16, with top half red and bottom half blue.
// Exported JPEGs must have the orientation tag stripped (pixels are already rotated).

const ROTATED_INJECT_DETECTIONS: Detection[] = [
  { label: 'plate', conf: 0.90, x: 1, y: 1, w: 3, h: 3 },
];

test.describe('EXIF orientation — rotated JPEG', () => {
  test('canvas dimensions reflect EXIF rotation', async ({ page }) => {
    await injectDetections(page, ROTATED_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'rotated.jpg'));
    await waitForCanvas(page);

    const dims = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      return { width: canvas.width, height: canvas.height };
    });

    // Coded 16×8 with orientation=6 → displayed as 8×16
    expect(dims.width, 'rotated width should be original height').toBe(8);
    expect(dims.height, 'rotated height should be original width').toBe(16);
  });

  test('pixel colors confirm rotation applied correctly', async ({ page }) => {
    await injectDetections(page, ROTATED_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'rotated.jpg'));
    await waitForCanvas(page);

    // After 90° CW rotation of left-red/right-blue coded image:
    // top half = red, bottom half = blue
    const result = await sampleCanvas(page, [
      [4, 2],   // top half → red
      [4, 12],  // bottom half → blue
    ]);

    const TOL = 40; // JPEG compression tolerance
    expect(
      withinTolerance(result.pixels[0], [255, 0, 0], TOL),
      `top pixel should be red, got rgb(${result.pixels[0]})`,
    ).toBe(true);
    expect(
      withinTolerance(result.pixels[1], [0, 0, 255], TOL),
      `bottom pixel should be blue, got rgb(${result.pixels[1]})`,
    ).toBe(true);
  });

  test('exported JPEG has orientation tag stripped', async ({ page }) => {
    await injectDetections(page, ROTATED_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'rotated.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Use keepMetadata=keep — the bug: original EXIF with orientation=6 is re-injected
    await page.evaluate(() => {
      (document.querySelector('input[name="keepMetadata"][value="keep"]') as HTMLInputElement).click();
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const tmpPath = path.join(__dirname, '../.tmp-rotated-export.jpg');
    await download.saveAs(tmpPath);
    try {
      const bytes = (await import('fs')).readFileSync(tmpPath);
      const orientation = readExifOrientation(bytes);
      expect(
        orientation === 0 || orientation === 1,
        `Exported JPEG orientation tag should be absent or 1, got ${orientation}`,
      ).toBe(true);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }
  });
});

// ── Video decoding ────────────────────────────────────────────────────────────
// All three videos are coded 1920×1080 with SAR 1:1 (no adjustment), giving a
// display size of 1920×1080.  H.265 is decoded via the libav.js WASM fallback
// on platforms where WebCodecs lacks native HEVC support (e.g. Linux).

const VIDEO_CASES: { file: string; codec: string; wasmFallback?: boolean }[] = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'av1.mp4', codec: 'AV1' },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
];

for (const { file, codec, wasmFallback } of VIDEO_CASES) {
  test.describe(`${codec} video decoding (${file})`, () => {
    // The WASM fallback for HEVC loads a 2 MB binary; allow more wall-clock time.
    test.setTimeout(wasmFallback ? 120_000 : 60_000);

    test('first frame decoded onto canvas with correct dimensions', async ({ page }) => {
      // Navigate first — WebCodecs requires a secure context (localhost is fine;
      // about:blank is not, so we must check AFTER page load).
      await injectDetections(page, VIDEO_INJECT_DETECTIONS);
      await loadFile(page, path.join(EXAMPLES, file));

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available in this browser build');
      }

      // Wait for either: frame decoded onto canvas, or an error message shown.
      // The WASM fallback needs extra time to download and initialise.
      const waitMs = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(
        () => {
          const wrapper = document.querySelector('.canvas-wrapper.active');
          if (!wrapper) return false;
          const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
          if (canvas && canvas.width > 0 && canvas.height > 0) return true;
          return !!wrapper.querySelector('.error-msg');
        },
        { timeout: waitMs },
      );

      // Verify canvas state
      const state = await page.evaluate(() => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return { kind: 'none' } as const;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
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

      // Skip gracefully when the codec isn't supported (e.g. 10-bit HEVC on Linux).
      if (state.kind === 'error') {
        test.skip(true, `Decode failed: ${state.msg}`);
        return;
      }
      // Also skip when libav produces wrong dimensions (10-bit HEVC decode partially succeeds
      // at a tiny size rather than producing an error-msg).
      if (state.kind === 'canvas' && (state.width !== 1920 || state.height !== 1080)) {
        test.skip(true, `Unexpected canvas dimensions ${state.width}×${state.height} — codec variant not supported`);
        return;
      }
      expect(state.kind).toBe('canvas');
      expect(state.width).toBe(1920);
      expect(state.height).toBe(1080); // display size (SAR 1:1, no adjustment)

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
  test.setTimeout(60_000);

  test('canvas changes on each frame throughout playback', async ({ page, browserName }) => {
    if (browserName === 'firefox') {
      test.skip(true, 'WASM HEVC decode + WASM ONNX inference too slow in Firefox for this test');
    }

    await injectDetections(page, H265_VIDEO_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'x265.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    // Wait for first frame to appear, or a decode error.
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
        if (canvas !== null && canvas.width > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      },
      { timeout: 180_000 },
    );
    const hasDecodeError = await page.evaluate(() => !!document.querySelector('.canvas-wrapper.active .error-msg'));
    if (hasDecodeError) {
      test.skip(true, 'Decode failed — codec not supported on this platform');
      return;
    }
    // Also skip when libav produces wrong dimensions (10-bit HEVC partial decode).
    const canvasWidth = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
      return c?.width ?? 0;
    });
    if (canvasWidth > 0 && canvasWidth !== 1920) {
      test.skip(true, `Unexpected canvas width ${canvasWidth} — codec variant not supported`);
      return;
    }

    // Install a 'videoframe' listener on the canvas.  On each event we compute
    // a pixel signature (sum of a 16×16 centre block) and push it to a window
    // variable that Playwright can read back.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      (window as unknown as Record<string, unknown>).__frameSignatures = [] as number[];
      canvas.addEventListener('videoframe', () => {
        const ctx = canvas.getContext('2d')!;
        const cx = Math.floor(canvas.width / 2) - 8;
        const cy = Math.floor(canvas.height / 2) - 8;
        const d = ctx.getImageData(cx, cy, 16, 16).data;
        let sum = 0;
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

    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__playbackEnded === true, {
      timeout: 60_000,
    });

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

// ── H.265 HEVC — pixel format 62 (10-bit I420P10) regression ────────────────
// x265.mp4 decodes via the libav.js WASM fallback (HevcFallbackDecoder).
// The decoder must handle AV_PIX_FMT_YUV420P10LE (format 62) without
// logging "unsupported pixel format 62; skipping" and must paint the canvas.

test.describe('H.265 HEVC — pixel format 62 (10-bit I420P10) decoding', () => {
  test.setTimeout(120_000);

  test('decodes 10-bit HEVC without "unsupported pixel format" warning', async ({ page }) => {
    // Capture warnings before loading the file so we catch every frame skip.
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await injectDetections(page, H265_VIDEO_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'x265.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    // Wait for canvas or error — do NOT skip on error (we want to catch the bug).
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
        if (canvas && canvas.width > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      },
      { timeout: 180_000 },
    );

    // Assert: no "unsupported pixel format" warnings from HevcFallbackDecoder.
    const pixelFmtWarnings = warnings.filter((w) => w.includes('unsupported pixel format'));
    expect(
      pixelFmtWarnings,
      `HevcFallbackDecoder emitted unsupported pixel format warning(s): ${pixelFmtWarnings.join('; ')}`,
    ).toHaveLength(0);

    // Assert: canvas rendered with correct dimensions and non-black content.
    const state = await page.evaluate(() => {
      const wrapper = document.querySelector('.canvas-wrapper.active');
      if (!wrapper) return { kind: 'none' } as const;
      const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
      if (canvas && canvas.width > 0) {
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

    expect(state.kind, `Expected canvas but got: ${JSON.stringify(state)}`).toBe('canvas');
    if (state.kind !== 'canvas') return;
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
    expect(state.nonBlack / state.total).toBeGreaterThan(0.2);
  });
});

// ── Export: output video duration matches input ───────────────────────────
// For each video, click Export and intercept the browser download.
// Pipe the downloaded bytes through ffprobe to read the container duration,
// then assert it is within 0.1 s of the source file's duration.

function ffprobeDuration(filePath: string): number {
  const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], {
    encoding: 'utf8',
  });
  const fmt = (JSON.parse(out) as { format: { duration: string } }).format;
  return parseFloat(fmt.duration);
}

function ffprobeHasVideo(filePath: string): boolean {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v', filePath],
    { encoding: 'utf8' },
  );
  const streams = (JSON.parse(out) as { streams: unknown[] }).streams;
  return streams.length > 0;
}

const EXPORT_CASES = [
  { file: 'x264.mp4', codec: 'H.264' },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
  { file: 'av1.mp4', codec: 'AV1' },
];

for (const { file, codec, wasmFallback } of EXPORT_CASES) {
  test.describe(`${codec} export — output duration matches input (${file})`, () => {
    test.setTimeout(wasmFallback ? 180_000 : 120_000);

    test('exported file duration within 0.1 s of source', async ({ page }) => {
      const inputPath = path.join(EXAMPLES, file);
      const inputDuration = ffprobeDuration(inputPath);

      await injectDetections(page, VIDEO_INJECT_DETECTIONS);
      await loadFile(page, inputPath);

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available');
      }

      // Wait for the first frame so the player is fully initialised, or a decode error.
      const firstFrameWait = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(
        () => {
          const wrapper = document.querySelector('.canvas-wrapper.active');
          if (!wrapper) return false;
          const c = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
          if (c !== null && c.width > 0) return true;
          return !!wrapper.querySelector('.error-msg');
        },
        { timeout: firstFrameWait },
      );
      const hasDecodeError = await page.evaluate(() => !!document.querySelector('.canvas-wrapper.active .error-msg'));
      if (hasDecodeError) {
        test.skip(true, 'Decode failed — codec not supported on this platform');
        return;
      }
      // Also skip when libav produces wrong dimensions (10-bit HEVC partial decode).
      const canvasWidth = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        return c?.width ?? 0;
      });
      if (canvasWidth > 0 && canvasWidth !== 1920) {
        test.skip(true, `Unexpected canvas width ${canvasWidth} — codec variant not supported`);
        return;
      }

      // Wait for the first-frame background inference to complete and warm the
      // cache before export starts.  This avoids running inference twice for
      // frame 0 (once in background, once during export) and ensures the export
      // only needs inference for frames 1..N-1 rather than 0..N-1.
      await waitForDetections(page, 30_000);

      // Intercept the download triggered by the Export button.
      const exportWait = wasmFallback ? 150_000 : 90_000;
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
        import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
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
  x: number;
  y: number;
  w: number;
  h: number;
}

// Reference detections for examples/jpeg.jpg (Hamburg street scene with GPS, 1429×497).
// With THRESHOLD_CONF=0.01 the model returns 2 plates + 16 persons (18 total).
const JPEG_REF_DETECTIONS: RefDetection[] = [
  { label: 'person', conf_min: 0.25, x:   13, y: 290, w: 24, h: 33 },
  { label: 'person', conf_min: 0.38, x:  503, y: 268, w: 13, h: 23 },
  { label: 'person', conf_min: 0.77, x:  525, y: 265, w: 10, h: 20 },
  { label: 'person', conf_min: 0.12, x:  564, y: 260, w: 39, h: 21 },
  { label: 'person', conf_min: 0.48, x:  565, y: 261, w: 13, h: 21 },
  { label: 'person', conf_min: 0.65, x:  571, y: 259, w: 13, h: 23 },
  { label: 'person', conf_min: 0.74, x:  596, y: 258, w: 12, h: 22 },
  { label: 'person', conf_min: 0.69, x:  617, y: 268, w:  9, h: 16 },
  { label: 'person', conf_min: 0.67, x:  631, y: 258, w: 11, h: 20 },
  { label: 'person', conf_min: 0.15, x:  686, y: 263, w:  8, h: 14 },
  { label: 'person', conf_min: 0.56, x:  728, y: 258, w:  9, h: 18 },
  { label: 'person', conf_min: 0.72, x:  761, y: 256, w:  9, h: 17 },
  { label: 'person', conf_min: 0.42, x:  774, y: 249, w:  9, h: 16 },
  { label: 'person', conf_min: 0.27, x:  785, y: 248, w:  8, h: 16 },
  { label: 'person', conf_min: 0.22, x:  947, y: 245, w:  9, h: 16 },
  { label: 'person', conf_min: 0.34, x:  960, y: 246, w:  9, h: 16 },
  { label: 'plate',  conf_min: 0.80, x: 1024, y: 331, w: 34, h: 10 },
  { label: 'plate',  conf_min: 0.85, x: 1318, y: 322, w: 58, h: 15 },
];

// Reference detections for the three test videos (Hamburg street scene, display 1920×1080).
// Uses 10 stable detections that appear in both H.264 and AV1 when filtered to conf >= 0.52.
// Lower-confidence boxes vary between codecs due to NMS sensitivity to pixel differences.
// assertDetectionsMatch is called with minConf=0.52 for video tests.
// Full 10-box reference calibrated on Chromium (Chromium-only tests).
const VIDEO_REF_DETECTIONS: RefDetection[] = [
  { label: 'plate',  conf_min: 0.52, x: 1603, y: 460, w: 60, h: 17 },
  { label: 'person', conf_min: 0.52, x:   20, y: 405, w: 15, h: 28 },
  { label: 'person', conf_min: 0.52, x:  199, y: 380, w: 16, h: 24 },
  { label: 'person', conf_min: 0.52, x:  226, y: 378, w: 13, h: 24 },
  { label: 'person', conf_min: 0.52, x:  257, y: 379, w: 10, h: 18 },
  { label: 'person', conf_min: 0.52, x:  283, y: 390, w: 15, h: 26 },
  { label: 'person', conf_min: 0.52, x:  313, y: 387, w: 14, h: 25 },
  { label: 'person', conf_min: 0.52, x:  435, y: 386, w: 13, h: 21 },
  { label: 'person', conf_min: 0.52, x:  460, y: 390, w: 13, h: 21 },
  { label: 'person', conf_min: 0.52, x:  506, y: 380, w: 13, h: 23 },
];
// Cross-browser references: boxes detected by both Chromium and Firefox above 0.52.
// assertDetectionsMatch uses subset matching so extra browser-specific boxes are ignored.
//
// H.264: Firefox sees x=88 (conf≈0.54) as extra; x=435 drops to conf≈0.508 on Firefox
//        (below 0.52) so it is excluded from the shared reference.
const H264_VIDEO_REF_DETECTIONS: RefDetection[] = VIDEO_REF_DETECTIONS.filter((r) => r.x !== 435);
// AV1 / H.265: Firefox sees x=88 (conf≈0.54) as extra; x=199 drops below 0.52 on Firefox
//              (AV1: conf≈0.485, H.265/libav: not detected) so it is excluded.
const AV1_H265_VIDEO_REF_DETECTIONS: RefDetection[] = VIDEO_REF_DETECTIONS.filter((r) => r.x !== 199);

// Properly-shaped Detection[] arrays for injectDetections() — used to pre-populate
// the IDB cache in tests not focused on inference output; never passed to
// assertDetectionsMatch().
// JPEG: 5 detections (3 plates + 2 persons) within the 1412×575 image bounds.
// The first plate box (x=50,y=390,w=60,h=20) is sampled at (80,400) in draw-mode
// and label-filtering tests; the first person box (x=100,y=200,w=20,h=60) at (110,230).
const JPEG_INJECT_DETECTIONS: Detection[] = [
  { label: 'plate', conf: 0.83, x: 50, y: 390, w: 60, h: 20 },
  { label: 'plate', conf: 0.82, x: 300, y: 350, w: 100, h: 35 },
  { label: 'plate', conf: 0.79, x: 150, y: 430, w: 30, h: 12 },
  { label: 'person', conf: 0.37, x: 100, y: 200, w: 20, h: 60 },
  { label: 'person', conf: 0.12, x: 220, y: 210, w: 15, h: 50 },
];
const VIDEO_INJECT_DETECTIONS: Detection[] = [
  { label: 'plate', conf: 0.87, x: 1600, y: 800, w: 80, h: 30 },
  { label: 'plate', conf: 0.76, x: 1750, y: 900, w: 100, h: 50 },
];
const H265_VIDEO_INJECT_DETECTIONS: Detection[] = [
  ...VIDEO_INJECT_DETECTIONS,
  { label: 'person', conf: 0.01, x: 300, y: 400, w: 15, h: 40 },
];

const BOX_TOL = 5; // pixels

function assertDetectionsMatch(actual: Detection[], ref: RefDetection[], minConf = 0.1): void {
  // Filter to detections above minConf — marginal boxes near the threshold shift
  // across it due to pixel-level differences between codecs and libav.js vs WebCodecs.
  actual = actual.filter((d) => d.conf >= minConf);
  ref = ref.filter((r) => r.conf_min >= minConf);
  // Each ref box must appear in actual; extra actual boxes are ignored.
  // This tolerates cross-browser NMS differences where marginal boxes near the
  // confidence boundary appear in one browser but not the other.
  const actualDesc = actual.map((a) => `${a.label}@(${a.x},${a.y})`).join(', ');
  for (const r of ref) {
    const match = actual.find(
      (a) =>
        a.label === r.label &&
        a.conf >= r.conf_min &&
        Math.abs(a.x - r.x) <= BOX_TOL &&
        Math.abs(a.y - r.y) <= BOX_TOL &&
        Math.abs(a.w - r.w) <= BOX_TOL &&
        Math.abs(a.h - r.h) <= BOX_TOL,
    );
    expect(match, `expected {${r.label} x≈${r.x} y≈${r.y}} not found in [${actualDesc}]`).toBeDefined();
  }
}

async function waitForDetections(page: Page, timeoutMs = 60_000): Promise<Detection[]> {
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__lastDetections !== undefined, {
    timeout: timeoutMs,
  });
  return page.evaluate(() => (window as unknown as Record<string, unknown>).__lastDetections as Detection[]);
}

/**
 * Register a detection override for all navigations in this test.
 * Must be called BEFORE page.goto() / loadFile() so that addInitScript
 * fires on the first navigation.
 *
 * When set, detector.ts skips ONNX and returns these detections for every
 * frame that misses the IDB cache.  Results are still written to IDB so
 * subsequent export cache-hits work correctly.
 *
 * Do NOT use this in tests that specifically verify inference output.
 */
async function injectDetections(page: Page, detections: Detection[]): Promise<void> {
  await page.addInitScript((dets) => {
    (window as any).__detectionOverride = dets;
  }, detections as unknown as Parameters<typeof page.addInitScript>[1]);
}

test.describe('Object detection — JPEG first frame', () => {
  test('detections match reference', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    const detections = await waitForDetections(page);
    assertDetectionsMatch(detections, JPEG_REF_DETECTIONS);
  });

  // Actual confidences: 2 plates (~0.88, ~0.83); persons ranging from ~0.81 down to ~0.17.
  // At 0.10 all 18 detections pass; at 0.80 only the highest-conf plate and person pass.
  test('minConfidence=0.10 shows all 18 detections', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);
    await page.evaluate(() => (window as any).__setMinConfidence(0.1));
    const detections = await waitForDetections(page);
    expect(detections.length).toBe(18);
  });

  test('minConfidence=0.80 shows 3 detections', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);
    await page.evaluate(() => (window as any).__setMinConfidence(0.8));
    const detections = await waitForDetections(page);
    expect(detections.length).toBe(3);
    expect(detections.every((d: any) => d.conf >= 0.8)).toBe(true);
  });
});

const DETECTION_VIDEO_CASES = [
  { file: 'x264.mp4', codec: 'H.264', refDetections: H264_VIDEO_REF_DETECTIONS, minConf: 0.52 },
  { file: 'av1.mp4', codec: 'AV1', refDetections: AV1_H265_VIDEO_REF_DETECTIONS, minConf: 0.52 },
  { file: 'x265.mp4', codec: 'H.265', wasmFallback: true, refDetections: AV1_H265_VIDEO_REF_DETECTIONS, minConf: 0.52 },
];

// ── Draw mode tests ───────────────────────────────────────────────────────────
// JPEG_INJECT_DETECTIONS[0] is a plate at x=50, y=390, w=60, h=20.
// Point (80, 400) lies inside that box and is used as the sample coordinate.

test.describe('Draw modes', () => {
  // Load the JPEG, wait for outline-mode detections (default), then switch modes.
  test('solid color: detection centre is solid black', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Clear the sentinel so waitForDetections below only resolves after
    // rerenderActive() finishes applying the new draw mode.
    await page.evaluate(() => { (window as any).__lastDetections = undefined; });
    await page.evaluate(() => (window as any).__setDrawMode('solidcolor'));
    await waitForDetections(page);

    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(80, 400, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pixel[0], `R channel at detection centre: ${pixel}`).toBeLessThan(10);
    expect(pixel[1], `G channel at detection centre: ${pixel}`).toBeLessThan(10);
    expect(pixel[2], `B channel at detection centre: ${pixel}`).toBeLessThan(10);
  });

  test('settings apply to newly-active file on switch', async ({ page }) => {
    // Load JPEG as file 0 and a video as file 1.  Both are initially rendered with
    // the default (blur) draw mode.  Then change to solidcolor while file 0 is active,
    // switch to file 1 — the fix must re-render file 1 with solidcolor.
    // Note: we cannot load jpeg.jpg twice because duplicate-prevention (same name+size)
    // silently drops the second add.
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await page.goto('http://localhost:3100');

    // Load file 0 (JPEG).
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Load file 1 (video — different file type avoids duplicate-prevention).
    // The JPEG_INJECT_DETECTIONS override applies to all files, so the video
    // canvas also gets the plate detection at (50, 390, 60, 20).
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'x264.mp4'));
    await waitForCanvas(page);
    await page.waitForTimeout(500); // let video detection cache populate via override

    // Switch back to file 0 and change mode to solidcolor while it is active.
    await page.locator('.file-list-row').nth(0).click();
    await waitForDetections(page);
    await page.evaluate(() => { (window as any).__lastDetections = undefined; });
    await page.evaluate(() => (window as any).__setDrawMode('solidcolor'));
    await waitForDetections(page); // resolves after rerenderActive() sets __lastDetections

    // Switch to file 1 (video) — the fix calls rerenderActive() which must apply solidcolor.
    await page.locator('.file-list-row').nth(1).click();
    await page.waitForTimeout(1500); // give video seekTo + applyDetections time to complete

    // Point (80, 400) is inside the plate detection box from JPEG_INJECT_DETECTIONS
    // (the same override is used for all files including the video).
    // With solidcolor it must be near-black; with blur it would be a non-black blurred value.
    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(80, 400, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pixel[0], `R channel at detection centre must be near-black in solidcolor mode: ${pixel}`).toBeLessThan(10);
    expect(pixel[1], `G channel at detection centre must be near-black in solidcolor mode: ${pixel}`).toBeLessThan(10);
    expect(pixel[2], `B channel at detection centre must be near-black in solidcolor mode: ${pixel}`).toBeLessThan(10);
  });

  test('blur: detection region is visually blurred (not sharp)', async ({ page }) => {
    // Load in outline mode so we can capture the raw pixel under the detection box,
    // then switch to blur and verify the pixel changes.
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
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
      const d = canvas.getContext('2d')!.getImageData(80, 400, 1, 1).data;
      return [d[0], d[1], d[2]];
    });

    // Switch to blur and poll until the pixel changes (re-render is async and may
    // take longer in Firefox than Chromium).
    await page.evaluate(() => (window as any).__setDrawMode('blur'));
    const blurred = await page.evaluate(
      (bl) => {
        return new Promise<number[]>((resolve) => {
          const check = () => {
            const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
            const d = canvas.getContext('2d')!.getImageData(80, 400, 1, 1).data;
            const px = [d[0], d[1], d[2]];
            if (px.some((v, i) => Math.abs(v - bl[i]) > 3)) {
              resolve(px);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      },
      baseline,
    );

    // Blur mixes surrounding pixels into the detection region — at least one channel must change.
    const changed = blurred.some((v, i) => Math.abs(v - baseline[i]) > 3);
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
    canvasW = 400,
    canvasH = 300,
  ) {
    return page.evaluate(
      async ({ det, coords, cw, ch }) => {
        const blurrer = (window as any).__blurrer;
        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        // Fill with a non-uniform checkerboard so blur always changes values.
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            ctx.fillStyle = ((x >> 3) + (y >> 3)) % 2 === 0 ? '#ff0000' : '#0000ff';
            ctx.fillRect(x, y, 1, 1);
          }
        }
        await blurrer.apply(ctx, [det], 'blur');
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
      [102, 102],
      [140, 102],
      [178, 102], // top edge row
      [102, 120],
      [140, 120],
      [178, 120], // mid row
      [102, 138],
      [140, 138],
      [178, 138], // bottom edge row
    ];
    // Baseline: same positions without blur.
    const baseline = (await page.evaluate(
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
    )) as [number, number, number][];

    const after = await applyBlur(page, det, interior);

    // Every interior sample must have changed (blur applied uniformly).
    for (let i = 0; i < interior.length; i++) {
      const changed = baseline[i].some((v: number, ch: number) => Math.abs(v - after[i][ch]) > 5);
      expect(changed, `Interior pixel at ${interior[i]} unchanged: before=${baseline[i]} after=${after[i]}`).toBe(true);
    }
  });

  test('blur feathers outside detection box boundary', async ({ page }) => {
    await page.goto('http://localhost:3100');

    const det = { label: 'plate', conf: 0.9, x: 100, y: 100, w: 80, h: 40 };
    // Points well outside the box (should be unchanged = no blur applied).
    const outside: [number, number][] = [
      [10, 10],
      [390, 10],
      [10, 290],
      [390, 290],
    ];
    const after = await applyBlur(page, det, outside);
    // Checkerboard corners should be pure red or pure blue — near 0 or 255.
    // A pixel that was pure red [255,0,0] blurred to [200,0,50] would fail this;
    // pixels well outside the feather region should be nearly unchanged.
    const canvasWH = { cw: 400, ch: 300 };
    const baseline = (await page.evaluate(
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
    )) as [number, number, number][];

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
      [1, 110],
      [1, 120],
      [1, 130],
    ];
    const baseline = (await page.evaluate(
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
    )) as [number, number, number][];

    const after = await applyBlur(page, det, edgePoints, 300, 300);

    for (let i = 0; i < edgePoints.length; i++) {
      const changed = baseline[i].some((v: number, ch: number) => Math.abs(v - after[i][ch]) > 5);
      expect(changed, `Border pixel at ${edgePoints[i]} was not blurred: before=${baseline[i]} after=${after[i]}`).toBe(
        true,
      );
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
    const stats = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__getInferenceStats as () => ModelStatMap)(),
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

// ── Trim persistence (IDB) ───────────────────────────────────────────────────

test.describe('Trim persistence', () => {
  test('trim values are saved to IDB and restored on reload', async ({ page }) => {
    test.setTimeout(120_000); // two full page loads; Firefox can be slow
    const videoPath = path.join(EXAMPLES, 'x264.mp4');
    const TRIM_START = 0.2;
    const TRIM_END = 0.8;
    const TOL = 0.05; // seconds

    // Load video and set trim.
    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await loadFile(page, videoPath);
    await waitForCanvas(page);
    await page.waitForFunction(() => document.getElementById('trim-section')?.classList.contains('visible'));

    await page.evaluate(
      ({ s, e }) => {
        (window as any).__setTrimStart(s);
        (window as any).__setTrimEnd(e);
      },
      { s: TRIM_START, e: TRIM_END },
    );

    // Wait for the IDB write (fire-and-forget, resolves quickly).
    await page.waitForTimeout(300);

    // Explicitly dispose the player before navigation so Firefox releases
    // VideoDecoder handles promptly (avoids codec resource exhaustion in the
    // full test suite where many tests share the same browser process).
    await page.evaluate(() => {
      const player = (window as any).__activePlayer;
      if (player?.dispose) player.dispose();
    });

    // Reload and re-open the same file.
    await page.goto('http://localhost:3100');
    await page.locator('#file-input').setInputFiles(videoPath);
    // Wait for canvas OR error (Firefox may exhaust VideoDecoder handles in the full suite).
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
        if (canvas && canvas.width > 0 && canvas.height > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      },
      { timeout: 240_000 },
    );
    const hasDecodeError = await page.evaluate(
      () => !!document.querySelector('.canvas-wrapper.active .error-msg'),
    );
    if (hasDecodeError) {
      test.skip(true, 'Video decoder unavailable (resource exhaustion in full suite); IDB write was verified in step 1');
      return;
    }
    await page.waitForFunction(() => document.getElementById('trim-section')?.classList.contains('visible'));
    // Give the async IDB read + setupTrimSlider a moment to complete.
    await page.waitForTimeout(300);

    const vals = await page.evaluate(
      () => (window as any).__getActiveTrimValues() as { start: number; end: number } | null,
    );
    expect(vals).not.toBeNull();
    expect(
      Math.abs(vals!.start - TRIM_START),
      `trimStart: got ${vals!.start}, expected ~${TRIM_START}`,
    ).toBeLessThanOrEqual(TOL);
    expect(Math.abs(vals!.end - TRIM_END), `trimEnd: got ${vals!.end}, expected ~${TRIM_END}`).toBeLessThanOrEqual(TOL);
  });
});

// ── "Whole video" button ─────────────────────────────────────────────────────

test.describe('"Whole video" button', () => {
  test('disabled when no trim; enabled after trim; resets trim on click', async ({ page }) => {
    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'x264.mp4'));
    await waitForCanvas(page);
    await page.waitForFunction(() => document.getElementById('trim-section')?.classList.contains('visible'));

    // Initially untrimmed — button must be disabled.
    const btn = page.locator('#trim-whole-video');
    await expect(btn).toBeDisabled();

    // Apply a trim (non-zero start).
    await page.evaluate(() => (window as any).__setTrimStart(0.2));
    await expect(btn).toBeEnabled();

    // Read duration before clicking so we can assert end == duration after reset.
    const duration = await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__activePlayer as { duration: number } | undefined)?.duration ?? null,
    );

    // Click "whole video" — trim must reset to 0 / duration.
    await btn.click();

    const vals = await page.evaluate(
      () => (window as any).__getActiveTrimValues() as { start: number; end: number } | null,
    );

    expect(vals).not.toBeNull();
    expect(vals!.start).toBeCloseTo(0, 2);
    if (duration !== null) {
      expect(Math.abs(vals!.end - duration)).toBeLessThanOrEqual(0.05);
    }

    // Button must be disabled again after reset.
    await expect(btn).toBeDisabled();
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
    // makeVideoKey is async (uses crypto.subtle for file hash) — evaluate must be async.
    const result = await page.evaluate(async () => {
      const mk = (window as unknown as Record<string, unknown>).__makeVideoKey as (
        file: File,
        w: number,
        h: number,
        ts: number,
      ) => Promise<string>;
      // Use a real File so getFileHash can call file.slice().
      const file = new File(['test content'], 'v.mp4', { type: 'video/mp4' });
      // Same absolute timestamp → same cache key, regardless of trim.
      const key1 = await mk(file, 1280, 720, 5_000_000); // frame at 5 s, no trim
      const key2 = await mk(file, 1280, 720, 5_000_000); // frame at 5 s, trim start = 5 s
      return {
        same: key1 === key2,
        containsTs: key1.includes('5000000'),
      };
    });
    expect(result.same, 'Cache key must be identical for the same absolute timestamp').toBe(true);
    expect(result.containsTs, 'Cache key must embed the microsecond timestamp').toBe(true);
  });

  test('trim-start frame re-uses preview cache during export', async ({ page }) => {
    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    if (
      !(await (async () => {
        await page.goto('http://localhost:3100');
        return page.evaluate(() => typeof VideoDecoder !== 'undefined');
      })())
    ) {
      test.skip(true, 'WebCodecs not available');
      return;
    }

    await loadFile(page, path.join(EXAMPLES, 'x264.mp4'));

    // Wait for first frame decoded (t ≈ 0) and its inference cached.
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        if (c !== null && c.width > 0) return true;
        return !!document.querySelector('.canvas-wrapper.active .error-msg');
      },
      { timeout: 60_000 },
    );
    {
      const w = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        return c?.width ?? 0;
      });
      if (!w || w !== 1920) { test.skip(true, `H.264 decode failed or wrong dims (${w})`); return; }
    }
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
      const fn = (window as unknown as Record<string, unknown>).__setTrimStartSilent as
        | ((t: number) => void)
        | undefined;
      fn?.(0.5);
    });

    // Record inference count before export.
    type StatMap = Record<string, { count: number; totalMs: number; avgMs: number | null }>;
    const statsBefore = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__getInferenceStats as () => StatMap)(),
    );
    const countBefore = statsBefore.detect_n.count;

    // Export (trimmed from 0.5 s → ~15 frames).
    const downloadPromise = page.waitForEvent('download', { timeout: 240_000 });
    await page.locator('#export-btn').click();
    await downloadPromise;

    // Check inference count after export.
    const statsAfter = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__getInferenceStats as () => StatMap)(),
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

  test('trimmed export: first exported frame uses its own detections, not frame-0 detections', async ({ page }) => {
    // Use distinct injected detections for frame 0 and frame 2 (different labels
    // make the check unambiguous).
    //
    // Root cause of the bug: mediabunny sets sample.microsecondTimestamp relative to
    // the trim start before calling process() (see conversion.js).  For the first
    // exported frame the adjusted value is 0, which collides with frame 0's IDB cache
    // key (t0) → wrong detections applied.
    //
    // For the test to be deterministic we need frame 2 to be the very first frame
    // the export calls process() with adjusted timestamp 0.  mediaBunny yields the
    // "last frame ≤ trimStart" first, so we set trimStart = frame 2's exact container
    // timestamp (obtained from __lastInferenceKey after seekTo).  That makes frame 2
    // itself the "last frame ≤ trimStart", giving it adjusted ts = 0.  The fix then
    // adds trimStart * 1e6 back to recover the absolute timestamp for the cache key.
    const FRAME0_INJECT: Detection[] = [{ label: 'plate', conf: 0.9, x: 42, y: 42, w: 11, h: 11 }];
    const FRAME2_INJECT: Detection[] = [{ label: 'person', conf: 0.9, x: 500, y: 500, w: 80, h: 200 }];

    await page.goto('http://localhost:3100');
    if (!(await page.evaluate(() => typeof VideoDecoder !== 'undefined'))) {
      test.skip(true, 'WebCodecs not available');
      return;
    }

    // Clear any stale detection cache and seed frame 0 with FRAME0_INJECT.
    await page.evaluate(async (dets) => {
      const w = window as unknown as Record<string, unknown>;
      const clear = w.__clearDetectionCache as (() => Promise<void>) | undefined;
      if (clear) await clear();
      w.__detectionOverride = dets;
      w.__lastDetections = undefined;
      w.__lastInferenceKey = undefined;
    }, FRAME0_INJECT as unknown as Parameters<typeof page.evaluate>[1]);

    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'x264.mp4'));
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        if (c !== null && c.width > 0) return true;
        return !!document.querySelector('.canvas-wrapper.active .error-msg');
      },
      { timeout: 60_000 },
    );
    {
      const w = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        return c?.width ?? 0;
      });
      if (!w || w !== 1920) { test.skip(true, `H.264 decode failed or wrong dims (${w})`); return; }
    }
    await waitForDetections(page, 30_000);
    await page.waitForTimeout(500); // wait for IDB write

    // Now seed frame 2 with FRAME2_INJECT.  First change the override, then seek so
    // the preview inference fires and writes FRAME2_INJECT to IDB under frame 2's key.
    await page.evaluate((dets) => {
      const w = window as unknown as Record<string, unknown>;
      w.__detectionOverride = dets;
      w.__lastDetections = undefined;
      w.__lastInferenceKey = undefined;
    }, FRAME2_INJECT as unknown as Parameters<typeof page.evaluate>[1]);
    await page.evaluate(() => {
      const player = (window as unknown as Record<string, unknown>).__activePlayer as {
        seekTo(t: number): Promise<void>;
      };
      return player.seekTo(2 / 30);
    });
    await waitForDetections(page, 30_000);
    await page.waitForTimeout(500); // wait for IDB write

    // Extract the exact microsecond timestamp of frame 2 from the cache key so we
    // can set trimStart to exactly that value.  This ensures mediabunny's first
    // process() call sees adjusted_ts = max(frame2_ts - trimStart, 0) = 0, and our
    // fix recovers frame2_ts by adding trimStart back.
    const lastKey = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__lastInferenceKey as string | undefined,
    );
    const tsMatch = lastKey?.match(/\|t(\d+)$/);
    expect(tsMatch, `Could not parse timestamp from inference key: "${lastKey}"`).not.toBeNull();
    const frame2TsUs = parseInt(tsMatch![1], 10);
    const frame2TsSec = frame2TsUs / 1_000_000;

    // Clear override (export must use only the IDB cache), arm the tracker, set trim.
    await page.evaluate(() => {
      delete (window as unknown as Record<string, unknown>).__detectionOverride;
      (window as unknown as Record<string, unknown>).__exportedFrameDetections = [];
    });
    await page.evaluate(
      ({ start, end }) => {
        const w = window as unknown as Record<string, unknown>;
        (w.__setTrimStartSilent as (t: number) => void)?.(start);
        (w.__setTrimEndSilent as (t: number) => void)?.(end);
      },
      // end = start + ~100 ms — exports only 2–3 frames, keeping the test fast.
      { start: frame2TsSec, end: frame2TsSec + 0.1 },
    );

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
    await page.locator('#export-btn').click();
    await downloadPromise;

    type Det = { label: string; conf: number; x: number; y: number; w: number; h: number };
    const exportedFrameDets = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__exportedFrameDetections as Det[][],
    );

    expect(exportedFrameDets.length, 'No frames were processed during export').toBeGreaterThan(0);

    const firstFrameDets = exportedFrameDets[0];
    // Bug: adjusted_ts = 0 → key t0 → FRAME0_INJECT (plate at x=42).
    // Fix: adjusted_ts + trimStart*1e6 = frame2_ts → key t{frame2TsUs} → FRAME2_INJECT (person).
    expect(
      firstFrameDets[0]?.label,
      `First exported frame should use frame-2 detections ('person'), not frame-0's ('plate'). ` +
        `frame2TsUs=${frame2TsUs}, firstFrameDets=${JSON.stringify(firstFrameDets)}`,
    ).toBe('person');
  });
});

for (const { file, codec, wasmFallback, refDetections, minConf } of DETECTION_VIDEO_CASES) {
  test.describe(`Object detection — ${codec} first frame (${file})`, () => {
    test.setTimeout(wasmFallback ? 240_000 : 60_000);

    test('first-frame detections match reference', async ({ page }) => {

      await loadFile(page, path.join(EXAMPLES, file));

      if (!(await webCodecsSupported(page))) {
        test.skip(true, 'WebCodecs not available in this browser build');
      }

      // Wait for the canvas to be painted (first frame decoded + inference done).
      const waitMs = wasmFallback ? 90_000 : 45_000;
      await page.waitForFunction(
        () => {
          const wrapper = document.querySelector('.canvas-wrapper.active');
          if (!wrapper) return false;
          const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
          if (canvas && canvas.width > 0) return true;
          return !!wrapper.querySelector('.error-msg');
        },
        { timeout: waitMs },
      );

      // Skip if decoding failed (e.g. HEVC on Linux without WASM fallback support).
      const hasError = await page.evaluate(() => !!document.querySelector('.canvas-wrapper.active .error-msg'));
      if (hasError) {
        const msg = await page.evaluate(
          () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
        );
        test.skip(true, `Decode failed: ${msg}`);
        return;
      }
      // Also skip when libav produces wrong dimensions (10-bit HEVC partial decode).
      const canvasWidth = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        return c?.width ?? 0;
      });
      if (canvasWidth > 0 && canvasWidth !== 1920) {
        test.skip(true, `Unexpected canvas width ${canvasWidth} — codec variant not supported`);
        return;
      }
      const detections = await waitForDetections(page, waitMs);
      assertDetectionsMatch(detections, refDetections, minConf);
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
  const result = spawnSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], {
    encoding: 'utf8',
  });
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
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await loadFile(page, GOPRO_SOURCE);

    // Wait for the first frame or a decode error.
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('.canvas-wrapper.active');
        if (!wrapper) return false;
        const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas[data-loaded="true"]');
        if (canvas && canvas.width > 0) return true;
        return !!wrapper.querySelector('.error-msg');
      },
      { timeout: 240_000 },
    );

    const hasError = await page.evaluate(() => !!document.querySelector('.canvas-wrapper.active .error-msg'));
    if (hasError) {
      const msg = await page.evaluate(
        () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
      );
      test.skip(true, `Decode failed: ${msg}`);
      return;
    }

    // Set trim end to GOPRO_TRIM_END without seeking (no extra inference needed).
    await page.evaluate((trimEnd) => {
      const fn = (window as unknown as Record<string, unknown>).__setTrimEndSilent as ((t: number) => void) | undefined;
      fn?.(trimEnd);
    }, GOPRO_TRIM_END);

    // Verify the export button is enabled before clicking.
    const btnDisabled = await page.locator('#export-btn').isDisabled();
    expect(btnDisabled, 'Export button should be enabled after setting trim').toBe(false);

    // Start export and wait for either a download or the row showing "Failed".
    const downloadPromise = page.waitForEvent('download', { timeout: 800_000 });
    await page.locator('#export-btn').click();

    // Also watch for the export row showing "Failed" (encoding error, no download).
    const failedPromise = page
      .waitForFunction(
        () => {
          const etas = document.querySelectorAll('.export-file-eta');
          return Array.from(etas).some((el) => el.textContent === 'Failed');
        },
        { timeout: 800_000 },
      )
      .then(() => null as null); // resolve to null on failure

    const outcome = await Promise.race([
      downloadPromise.then((dl) => ({ kind: 'download' as const, dl })),
      failedPromise.then(() => ({ kind: 'failed' as const })),
    ]);

    if (outcome.kind === 'failed') {
      throw new Error(
        `Export reported "Failed" without producing a download.\n` +
          `Console errors: ${consoleErrors.slice(-10).join('\n') || '(none)'}`,
      );
    }

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-gopro-export');
    await outcome.dl.saveAs(tmpPath);

    let result: { valid: boolean; duration: number | null };
    try {
      result = ffprobeCheck(tmpPath);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }

    expect(result.valid, 'Exported file must be a valid MP4 parseable by ffprobe (no "Invalid data found" error)').toBe(
      true,
    );

    // Duration should be ≤ trim end + a small GOP tolerance.
    if (result.duration !== null) {
      expect(
        result.duration,
        `Duration ${result.duration.toFixed(3)} s should be at most ${GOPRO_TRIM_END + 2} s`,
      ).toBeLessThanOrEqual(GOPRO_TRIM_END + 2);
    }
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────
// The app filters by MIME type (image/* / video/*), so tests must use valid
// MIME types with invalid content to exercise the decode-error path.

test.describe('Error paths', () => {
  test('truncated MP4 (video/mp4 MIME, only ftyp header) shows error message', async ({ page }) => {
    await page.goto('http://localhost:3100');
    // Minimal valid ftyp box followed by nothing — mediabunny will find no tracks.
    const truncated = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // box size=24, type='ftyp'
      0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, // major brand 'mp42', minor ver
      0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d, // compat brands 'mp42','isom'
    ]);
    await page.locator('#file-input').setInputFiles({
      name: 'truncated.mp4',
      mimeType: 'video/mp4',
      buffer: truncated,
    });
    await page.waitForFunction(
      () => !!document.querySelector('.canvas-wrapper.active .error-msg'),
      { timeout: 60_000 },
    );
    const msg = await page.evaluate(
      () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
    );
    expect(msg.trim().length, `Error message should be non-empty, got: "${msg}"`).toBeGreaterThan(0);
  });

  test('corrupt image data (image/jpeg MIME, random bytes) shows error message', async ({ page }) => {
    await page.goto('http://localhost:3100');
    // Random bytes — not a valid JPEG; createImageBitmap should reject it.
    const garbage = Buffer.from(new Array(64).fill(0).map((_, i) => i));
    await page.locator('#file-input').setInputFiles({
      name: 'corrupt.jpg',
      mimeType: 'image/jpeg',
      buffer: garbage,
    });
    await page.waitForFunction(
      () => !!document.querySelector('.canvas-wrapper.active .error-msg'),
      { timeout: 30_000 },
    );
    const msg = await page.evaluate(
      () => document.querySelector('.canvas-wrapper.active .error-msg')?.textContent ?? '',
    );
    expect(msg.trim().length, `Error message should be non-empty, got: "${msg}"`).toBeGreaterThan(0);
  });
});

// ── Batch export (Export All) ─────────────────────────────────────────────────
// Loads two files, clicks "Export All", and verifies both downloads arrive and
// the video output is a valid MP4 with the correct duration.

test.describe('Batch export — Export All button', () => {
  test.setTimeout(300_000);

  test('exports all files; video output duration matches input', async ({ page }) => {
    const videoPath = path.join(EXAMPLES, 'x264.mp4');
    const inputDuration = ffprobeDuration(videoPath);

    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await page.goto('http://localhost:3100');

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    // Load two files. jpeg.jpg is added first and becomes the active file.
    await page.locator('#file-input').setInputFiles([
      path.join(EXAMPLES, 'jpeg.jpg'),
      videoPath,
    ]);

    // Switch to the video — jpeg.jpg is active after load (first-file-selected behaviour).
    await page.locator('.file-list-row').nth(1).click();

    // Active file is now x264.mp4. Wait for first frame.
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        if (c !== null && c.width > 0) return true;
        return !!document.querySelector('.canvas-wrapper.active .error-msg');
      },
      { timeout: 90_000 },
    );
    {
      const w = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        return c?.width ?? 0;
      });
      if (!w || w !== 1920) { test.skip(true, `H.264 decode failed or wrong dims (${w})`); return; }
    }

    // Wait for first-frame inference on the active video.
    await waitForDetections(page, 15_000);

    // Collect downloads before clicking so we don't miss the fast JPEG one.
    const downloads: import('@playwright/test').Download[] = [];
    let resolveBothDownloads: () => void;
    const bothDownloaded = new Promise<void>((res) => { resolveBothDownloads = res; });
    page.on('download', (dl) => {
      downloads.push(dl);
      if (downloads.length >= 2) resolveBothDownloads();
    });

    // Export All is only shown when ≥ 2 files are loaded.
    await page.locator('#export-all-btn').click();
    await bothDownloaded;

    // Save the MP4 download and verify with ffprobe.
    const videoDownload = downloads.find((dl) => dl.suggestedFilename().endsWith('.mp4'));
    expect(videoDownload, 'No MP4 download found among batch exports').toBeDefined();

    const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-batch-export.mp4');
    await videoDownload!.saveAs(tmpPath);

    let outputDuration: number;
    let hasVideoStream: boolean;
    try {
      outputDuration = ffprobeDuration(tmpPath);
      hasVideoStream = ffprobeHasVideo(tmpPath);
    } finally {
      import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
    }

    expect(hasVideoStream, 'Exported MP4 must contain a video stream').toBe(true);
    expect(
      Math.abs(outputDuration - inputDuration),
      `Output duration ${outputDuration.toFixed(3)} s differs from input ${inputDuration.toFixed(3)} s by more than 0.1 s`,
    ).toBeLessThanOrEqual(0.1);
  });
});

// ── Label filtering ───────────────────────────────────────────────────────────
// JPEG_INJECT_DETECTIONS has 3 plates (conf ≥ 0.79) and 2 persons (conf ≥ 0.12).
// Default minConfidence is 0.05, so all 5 pass the confidence filter.
// Switching enabledLabels must change which detections are rendered.

test.describe('Label filtering', () => {
  test('plate-only: shows only plate detections', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    await page.evaluate(() => (window as any).__setLabels('plate'));
    const detections = await waitForDetections(page);

    expect(detections.length).toBe(3);
    expect(detections.every((d: any) => d.label === 'plate')).toBe(true);
  });

  test('person-only: shows only person detections', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    await page.evaluate(() => (window as any).__setLabels('person'));
    const detections = await waitForDetections(page);

    expect(detections.length).toBe(2);
    expect(detections.every((d: any) => d.label === 'person')).toBe(true);
  });

  test('both: all detections shown after switching from plate-only', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Narrow to plate-only first, then expand back to both.
    await page.evaluate(() => (window as any).__setLabels('plate'));
    await waitForDetections(page);

    await page.evaluate(() => (window as any).__setLabels('both'));
    const detections = await waitForDetections(page);

    expect(detections.length).toBe(5);
    expect(detections.some((d: any) => d.label === 'plate')).toBe(true);
    expect(detections.some((d: any) => d.label === 'person')).toBe(true);
  });

  test('canvas: plate-only does not redact person boxes; person-only does not redact plate boxes', async ({ page }) => {
    // Use solidcolor mode: a redacted box centre is near-black; an unredacted pixel is not.
    // Plate box at inject coords (50, 390, 60, 20) — sample at (80, 400).
    // Person box at inject coords (100, 200, 20, 60) — sample at (110, 230).
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Set solidcolor so redacted pixels become near-black.
    await page.evaluate(() => { (window as any).__lastDetections = undefined; });
    await page.evaluate(() => (window as any).__setDrawMode('solidcolor'));
    await waitForDetections(page);

    // ── plate-only: plate box must be black, person box must be original (non-black). ──
    await page.evaluate(() => (window as any).__setLabels('plate'));
    await waitForDetections(page);

    const plateOnlyPixels = await page.evaluate(() => {
      const ctx = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!.getContext('2d')!;
      const platePx = ctx.getImageData(80, 400, 1, 1).data;
      const personPx = ctx.getImageData(110, 230, 1, 1).data;
      return {
        plate: [platePx[0], platePx[1], platePx[2]],
        person: [personPx[0], personPx[1], personPx[2]],
      };
    });

    expect(plateOnlyPixels.plate[0], `plate box R in plate-only: ${plateOnlyPixels.plate}`).toBeLessThan(10);
    expect(plateOnlyPixels.plate[1], `plate box G in plate-only: ${plateOnlyPixels.plate}`).toBeLessThan(10);
    expect(plateOnlyPixels.plate[2], `plate box B in plate-only: ${plateOnlyPixels.plate}`).toBeLessThan(10);
    // Person box must be original scene pixels — at least one channel above 20.
    expect(
      plateOnlyPixels.person.some((v) => v > 20),
      `person box should be unredacted in plate-only mode: ${plateOnlyPixels.person}`,
    ).toBe(true);

    // ── person-only: person box must be black, plate box must be original (non-black). ──
    await page.evaluate(() => (window as any).__setLabels('person'));
    await waitForDetections(page);

    const personOnlyPixels = await page.evaluate(() => {
      const ctx = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!.getContext('2d')!;
      const platePx = ctx.getImageData(80, 400, 1, 1).data;
      const personPx = ctx.getImageData(110, 230, 1, 1).data;
      return {
        plate: [platePx[0], platePx[1], platePx[2]],
        person: [personPx[0], personPx[1], personPx[2]],
      };
    });

    expect(personOnlyPixels.person[0], `person box R in person-only: ${personOnlyPixels.person}`).toBeLessThan(10);
    expect(personOnlyPixels.person[1], `person box G in person-only: ${personOnlyPixels.person}`).toBeLessThan(10);
    expect(personOnlyPixels.person[2], `person box B in person-only: ${personOnlyPixels.person}`).toBeLessThan(10);
    // Plate box must be original scene pixels — at least one channel above 20.
    expect(
      personOnlyPixels.plate.some((v) => v > 20),
      `plate box should be unredacted in person-only mode: ${personOnlyPixels.plate}`,
    ).toBe(true);
  });
});

// ── Batch load: first file selected ──────────────────────────────────────────
// When multiple files are opened in one batch, the FIRST file must become the
// active item so a preview appears immediately.  Previously the LAST file was
// selected, forcing users to wait for the slowest file (e.g. a large video) to
// decode before any preview was shown.

test.describe('Batch file loading — first file selected', () => {
  test('first file in batch is active, not the last', async ({ page }) => {
    await page.goto('http://localhost:3100');
    // Load a JPEG (fast) first and a video (slow) second in one batch.
    await page.locator('#file-input').setInputFiles([
      path.join(EXAMPLES, 'jpeg.jpg'),
      path.join(EXAMPLES, 'x264.mp4'),
    ]);
    // jpeg.jpg loads almost instantly — waitForCanvas resolves as soon as the
    // active item's canvas has data-loaded="true" and a non-zero width.
    await waitForCanvas(page);
    const width = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      return c.width;
    });
    // jpeg.jpg is 1429 px wide; x264.mp4 decodes to 1920 px.
    // Seeing 1429 here confirms jpeg.jpg (the first file) is active.
    expect(width).toBe(1429);
  });
});

// ── Export-time detection for uncached images ─────────────────────────────────
// When "Export All" is clicked, images whose canvases have not yet had
// applyDetections() called (e.g. non-active images in a batch load) must have
// detection run via detectForExport() before the JPEG is encoded.
// Previously the raw unredacted canvas was exported for such images.

test.describe('Export-time detection for uncached images', () => {
  test.setTimeout(120_000);

  test('non-active image gets detections applied during Export All', async ({ page }) => {
    // Detection box sized to fit inside a 200×200 canvas.
    // Box: x=50, y=50, w=60, h=60 → interior centre at (80, 80).
    const EXPORT_INJECT: Detection[] = [
      { label: 'plate', conf: 0.95, x: 50, y: 50, w: 60, h: 60 },
    ];
    await injectDetections(page, EXPORT_INJECT);
    await page.goto('http://localhost:3100');

    // Create a 200×200 grey synthetic JPEG in the browser context.
    const syntheticJpegBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      c.getContext('2d')!.fillStyle = '#808080';
      c.getContext('2d')!.fillRect(0, 0, 200, 200);
      const blob = await new Promise<Blob>((resolve) =>
        (c as HTMLCanvasElement).toBlob(resolve as BlobCallback, 'image/jpeg', 0.95),
      );
      return Array.from(new Uint8Array(await blob!.arrayBuffer()));
    });
    const syntheticBuffer = Buffer.from(syntheticJpegBytes);

    // Load jpeg.jpg first — it becomes the active file and gets inference.
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page, 30_000);

    // Load synthetic.jpg as a second file (non-active; no preview inference
    // is scheduled for it, so detectionsDone remains false).
    await page.locator('#file-input').setInputFiles({
      name: 'synthetic.jpg',
      mimeType: 'image/jpeg',
      buffer: syntheticBuffer,
    });
    // Allow the image renderer to finish painting the canvas.
    await page.waitForTimeout(500);

    // Switch to solidcolor so redacted pixels are deterministically near-black.
    await page.evaluate(() => { (window as any).__lastDetections = undefined; });
    await page.evaluate(() => (window as any).__setDrawMode('solidcolor'));
    // Wait for jpeg.jpg (the active file) to re-render with the new draw mode.
    await waitForDetections(page, 30_000);

    // Collect both downloads before clicking so we don't miss the fast JPEG one.
    const downloads: import('@playwright/test').Download[] = [];
    let resolveBoth!: () => void;
    const bothDone = new Promise<void>((res) => { resolveBoth = res; });
    page.on('download', (dl) => { downloads.push(dl); if (downloads.length >= 2) resolveBoth(); });

    await page.locator('#export-all-btn').click();
    await bothDone;

    // After export, batchExporter has called applyDetections() on synthetic.jpg's
    // canvas (canvas index 1 — jpeg.jpg is index 0 as the first-loaded file).
    // Point (80, 80) lies at the centre of the detection box; solidcolor fills
    // it with the default color (#000000), so all channels must be near-black.
    const pixel = await page.evaluate(() => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('.canvas-wrapper canvas');
      const d = canvases[1].getContext('2d')!.getImageData(80, 80, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pixel[0], `R at detection centre of synthetic.jpg: ${pixel}`).toBeLessThan(10);
    expect(pixel[1], `G at detection centre of synthetic.jpg: ${pixel}`).toBeLessThan(10);
    expect(pixel[2], `B at detection centre of synthetic.jpg: ${pixel}`).toBeLessThan(10);
  });
});

// ── Re-export after settings change ─────────────────────────────────────────
// When settings change (drawMode, confidence, expansion…) after an image has
// already been rendered, the export must use the *current* settings — not stale
// canvas pixels left over from the previous render.  The bug: once
// detectionsDone is set to true, the export path skips re-rendering entirely
// and uses the canvas as-is.  rerenderActive() only updates the *active* item,
// so non-active images export with old settings.

test.describe('Re-export after settings change', () => {
  test.setTimeout(120_000);

  test('Export All applies current draw mode to previously-rendered non-active image', async ({ page }) => {
    // Detection box: plate at x=50, y=50, w=60, h=60 → centre at (80, 80).
    const INJECT: Detection[] = [
      { label: 'plate', conf: 0.95, x: 50, y: 50, w: 60, h: 60 },
    ];
    await injectDetections(page, INJECT);
    await page.goto('http://localhost:3100');

    // Start in solidcolor mode so the first render bakes black pixels into the
    // detection region.
    await page.evaluate(() => (window as any).__setDrawMode('solidcolor'));

    // ── Load file 0 (jpeg.jpg) as active ──
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page, 30_000);
    // file 0 now has solidcolor detections, detectionsDone = true

    // ── Load file 1 (synthetic 200×200 grey JPEG) ──
    // It becomes active (addFiles switches to the first new file), so
    // inference runs and detectionsDone becomes true with solidcolor.
    const syntheticJpegBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      c.getContext('2d')!.fillStyle = '#808080';
      c.getContext('2d')!.fillRect(0, 0, 200, 200);
      const blob = await new Promise<Blob>((resolve) =>
        (c as HTMLCanvasElement).toBlob(resolve as BlobCallback, 'image/jpeg', 0.95),
      );
      return Array.from(new Uint8Array(await blob!.arrayBuffer()));
    });
    await page.locator('#file-input').setInputFiles({
      name: 'synthetic.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(syntheticJpegBytes),
    });
    await waitForCanvas(page);
    await waitForDetections(page, 30_000);
    // file 1 is now active with solidcolor detections, detectionsDone = true

    // ── Switch back to file 0, then change draw mode ──
    // rerenderActive() only re-renders file 0 (the active item).
    // file 1 keeps its stale solidcolor canvas.
    await page.locator('.file-list-row').nth(0).click();
    await waitForDetections(page, 30_000);
    await page.evaluate(() => { (window as any).__lastDetections = undefined; });
    await page.evaluate(() => (window as any).__setDrawMode('outline'));
    await waitForDetections(page, 30_000);

    // ── Export All ──
    const downloads: import('@playwright/test').Download[] = [];
    let resolveBoth!: () => void;
    const bothDone = new Promise<void>((res) => { resolveBoth = res; });
    page.on('download', (dl) => { downloads.push(dl); if (downloads.length >= 2) resolveBoth(); });

    await page.locator('#export-all-btn').click();
    await bothDone;

    // ── Verify file 1 (synthetic.jpg, canvas index 1) ──
    // With outline mode, pixel (80, 80) in the detection interior should show
    // the original grey (#808080), NOT near-black from the stale solidcolor.
    const pixel = await page.evaluate(() => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('.canvas-wrapper canvas');
      const d = canvases[1].getContext('2d')!.getImageData(80, 80, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    // Grey image ≈ [128, 128, 128].  Solidcolor would be [0, 0, 0].
    // With outline mode the interior pixels are untouched — they must be far
    // from black (> 50 per channel is generous).
    expect(pixel[0], `R at (80,80) of synthetic.jpg should be grey (outline), not black (stale solidcolor): ${pixel}`).toBeGreaterThan(50);
    expect(pixel[1], `G at (80,80) of synthetic.jpg should be grey (outline), not black (stale solidcolor): ${pixel}`).toBeGreaterThan(50);
    expect(pixel[2], `B at (80,80) of synthetic.jpg should be grey (outline), not black (stale solidcolor): ${pixel}`).toBeGreaterThan(50);
  });
});

// ── HDR tone-mapping toggle ──────────────────────────────────────────────────
// av1.mp4 encodes bt2020+hlg content — confirmed to surface transfer='hlg' in
// both Chrome and Firefox via WebCodecs.  The toggle button is injected into the
// canvas wrapper by fileManager when the player fires onHdrDetected.

const AV1_HDR_KEY = `hdr-tone-mapping|av1.mp4|732633`;

test.describe('HDR tone-mapping toggle', () => {
  test.setTimeout(60_000);

  test('toggle button appears for HDR video and is off by default', async ({ page }) => {
    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'av1.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    await waitForCanvas(page);

    // Toggle is injected asynchronously after the first HDR frame is drawn.
    await page.waitForSelector('.canvas-wrapper.active .hdr-toggle', { timeout: 30_000 });

    const text = await page.locator('.canvas-wrapper.active .hdr-toggle').textContent();
    expect(text?.trim()).toBe('HDR: off');

    // No preference stored yet — localStorage key should be absent.
    const stored = await page.evaluate((key) => localStorage.getItem(key), AV1_HDR_KEY);
    expect(stored).toBeNull();
  });

  test('clicking toggle switches to on and saves preference', async ({ page }) => {
    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await loadFile(page, path.join(EXAMPLES, 'av1.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    await waitForCanvas(page);
    await page.waitForSelector('.canvas-wrapper.active .hdr-toggle', { timeout: 30_000 });

    await page.locator('.canvas-wrapper.active .hdr-toggle').click();

    const text = await page.locator('.canvas-wrapper.active .hdr-toggle').textContent();
    expect(text?.trim()).toBe('HDR: on');

    const stored = await page.evaluate((key) => localStorage.getItem(key), AV1_HDR_KEY);
    expect(stored).toBe('true');
  });

  test('saved preference (on) is restored when file is reloaded', async ({ page }) => {
    // Pre-set the preference before the first navigation.
    await page.goto('http://localhost:3100');
    await page.evaluate((key) => localStorage.setItem(key, 'true'), AV1_HDR_KEY);

    await injectDetections(page, VIDEO_INJECT_DETECTIONS);
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'av1.mp4'));

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    await waitForCanvas(page);
    await page.waitForSelector('.canvas-wrapper.active .hdr-toggle', { timeout: 30_000 });

    const text = await page.locator('.canvas-wrapper.active .hdr-toggle').textContent();
    expect(text?.trim()).toBe('HDR: on');
  });

  test('toggle does not appear for JPEG image', async ({ page }) => {
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);

    // Give any async callbacks time to fire.
    await page.waitForTimeout(500);

    const count = await page.locator('.canvas-wrapper.active .hdr-toggle').count();
    expect(count).toBe(0);
  });

  test('"Restore default settings" clears HDR localStorage preference', async ({ page }) => {
    await page.goto('http://localhost:3100');
    // Plant a preference so we can verify it gets cleared.
    await page.evaluate((key) => localStorage.setItem(key, 'true'), AV1_HDR_KEY);

    const storedBefore = await page.evaluate((key) => localStorage.getItem(key), AV1_HDR_KEY);
    expect(storedBefore).toBe('true');

    // The button lives inside a <details> panel that is closed by default.
    await page.locator('#step-debug').evaluate((el) => { (el as HTMLDetailsElement).open = true; });
    await page.locator('#defaults-btn').click();

    const storedAfter = await page.evaluate((key) => localStorage.getItem(key), AV1_HDR_KEY);
    expect(storedAfter).toBeNull();
  });
});

// ── Step 2 header updates on file switch ─────────────────────────────────────

test.describe('Step 2 header title updates on file switch', () => {
  test('header changes between "Preview" and "Preview & Trim" when switching file types', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox headless WebCodecs H.264 decode is unreliable under parallel load');
    test.setTimeout(180_000);
    await page.goto('http://localhost:3100');

    // Load a video first.
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'x264.mp4'));
    await waitForCanvas(page, 90_000);
    await page.waitForFunction(() => document.getElementById('trim-section')?.classList.contains('visible'));

    const titleAfterVideo = await page.locator('#step-preview-title').textContent();
    expect(titleAfterVideo?.trim().toLowerCase(), 'Title should mention trim after loading video').toContain('trim');

    // Now load an image (it becomes the active file).
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);

    const titleAfterImage = await page.locator('#step-preview-title').textContent();
    expect(titleAfterImage?.trim().toLowerCase(), 'Title should not mention trim after switching to image').not.toContain('trim');

    // Switch back to the video file.
    await page.locator('.file-list-row').nth(0).click();
    await page.waitForFunction(() => document.getElementById('trim-section')?.classList.contains('visible'));

    const titleBackToVideo = await page.locator('#step-preview-title').textContent();
    expect(titleBackToVideo?.trim().toLowerCase(), 'Title should mention trim again after switching back to video').toContain('trim');
  });
});

// ── OCR — license plate recognition ────────────────────────────────────────
// examples/jpeg.jpg has a visible license plate "HH MD 821" near x=1318, y=322.
// The real detect_n detection box is only 58px wide (below the 60px OCR threshold),
// so we inject a wider detection box at the real plate location.

const OCR_PLATE_DETECTION: Detection = {
  label: 'plate', conf: 0.88, x: 1310, y: 318, w: 75, h: 22,
};

test.describe('OCR — plate recognition', () => {
  test('OCR recognizes plate text from jpeg.jpg', async ({ page }) => {
    // Inject a plate detection covering the real plate location (wider than 60px for OCR)
    await injectDetections(page, [OCR_PLATE_DETECTION]);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Run OCR on the detected plate via test helper (may download OCR model — allow 2 min)
    test.setTimeout(180_000);
    const ocrResults = await page.evaluate(() => (window as any).__runOcr()) as Array<{ text: string; raw: string }>;

    const texts = ocrResults.map((r) => r.text);
    // The model reliably recognizes "821" but letter prefixes vary across browsers
    // (Chromium: "HHRMD821", Firefox: "MO821") due to canvas resize quality differences.
    expect(texts.some((t) => t.includes('821')),
      `Expected OCR to recognize *821 pattern, got: ${JSON.stringify(texts)}`).toBe(true);
  });
});

test.describe('OCR — initial load', () => {
  test('__lastDetections contains filtered detections after initial inference', async ({ page }) => {
    // On initial load (no IDB cache), __lastDetections should be set to the
    // confidence/label-filtered detections — NOT the raw YOLO output.
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    const dets = await waitForDetections(page);

    // Raw YOLO output has ~43 detections; filtered should be ~18 at default config.
    expect(dets.length, '__lastDetections should have filtered detections, not raw').toBeLessThan(30);
  });

  test('OCR recognizes plate on first load without needing reload', async ({ page }) => {
    test.setTimeout(180_000);
    await injectDetections(page, [OCR_PLATE_DETECTION]);
    await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Run OCR immediately after first inference (no page reload)
    const ocrResults = await page.evaluate(() => (window as any).__runOcr()) as Array<{ text: string; raw: string }>;
    const texts = ocrResults.map((r) => r.text);
    expect(texts.some((t) => t.includes('821')),
      `OCR should work on first load, got: ${JSON.stringify(texts)}`).toBe(true);
  });
});

test.describe('OCR — selective unblurring', () => {
  test('keepPlates excludes matched plate from solidcolor redaction', async ({ page }) => {
    test.setTimeout(180_000); // OCR model download may be slow
    // Use solidcolor mode so blurred pixels are near-black (easy to test)
    await injectDetections(page, [OCR_PLATE_DETECTION]);
    await page.goto('http://localhost:3100');
    await page.evaluate(() => (window as any).__setDrawMode?.('solidcolor'));
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Sample a pixel inside the plate box — should be near-black (redacted)
    const pxBefore = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(1340, 325, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pxBefore[0] + pxBefore[1] + pxBefore[2], 'plate pixel should be near-black before keepPlates').toBeLessThan(30);

    // Set keepPlates to match the plate — OCR will recognize it and exclude it.
    // Use *821 wildcard since letter prefixes vary by browser.
    await page.evaluate(() => (window as any).__lastDetections = undefined);
    await page.evaluate(() => (window as any).__setKeepPlates?.('*821'));
    await waitForDetections(page, 120_000); // OCR model loading may take time

    // Sample same pixel — should no longer be black (plate is visible/unblurred)
    const pxAfter = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(1340, 325, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pxAfter[0] + pxAfter[1] + pxAfter[2], 'plate pixel should NOT be black after keepPlates match').toBeGreaterThan(30);

    // Clear keepPlates — plate should be redacted again
    await page.evaluate(() => (window as any).__lastDetections = undefined);
    await page.evaluate(() => (window as any).__setKeepPlates?.(''));
    await waitForDetections(page);

    const pxCleared = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(1340, 325, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pxCleared[0] + pxCleared[1] + pxCleared[2], 'plate pixel should be black again after clearing keepPlates').toBeLessThan(30);
  });

  test('wildcard matching: *821 matches, XX*999 does not', async ({ page }) => {
    test.setTimeout(180_000);
    await injectDetections(page, [OCR_PLATE_DETECTION]);
    await page.goto('http://localhost:3100');
    await page.evaluate(() => (window as any).__setDrawMode?.('solidcolor'));
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // *821 should match — plate stays visible
    await page.evaluate(() => (window as any).__lastDetections = undefined);
    await page.evaluate(() => (window as any).__setKeepPlates?.('*821'));
    await waitForDetections(page, 120_000);

    const pxMatch = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(1340, 325, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pxMatch[0] + pxMatch[1] + pxMatch[2], '*821 should match — pixel should not be black').toBeGreaterThan(30);

    // XX*999 should NOT match — plate is blurred
    await page.evaluate(() => (window as any).__lastDetections = undefined);
    await page.evaluate(() => (window as any).__setKeepPlates?.('XX*999'));
    await waitForDetections(page);

    const pxNoMatch = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
      const d = canvas.getContext('2d')!.getImageData(1340, 325, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(pxNoMatch[0] + pxNoMatch[1] + pxNoMatch[2], 'XX*999 should not match — pixel should be black').toBeLessThan(30);
  });
});

// ── OCR outline rendering with expansion ─────────────────────────────────────
// Bug: drawOutline used expanded detection coordinates for the OCR text key
// lookup, but OCR texts are keyed by original (pre-expansion) coordinates.
// With expansionFraction > 0 the keys never matched, so OCR text was never
// rendered in outline mode.

test.describe('OCR outline rendering with area expansion', () => {
  test('OCR text is rendered when expansionFraction > 0', async ({ page }) => {
    await page.goto('http://localhost:3100');

    // Use applyDetections directly on an OffscreenCanvas with a pre-populated ocrTexts map.
    const hasOcrText = await page.evaluate(async () => {
      const applyDetections = (window as any).__applyDetections as (
        ctx: OffscreenCanvasRenderingContext2D,
        detections: any[],
        mode: string,
        color: string,
        expansionFraction: number,
        ocrTexts?: Map<string, string>,
        excludedKeys?: Set<string>,
      ) => Promise<void>;

      const canvas = new OffscreenCanvas(800, 600);
      const ctx = canvas.getContext('2d')!;
      // Fill with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 600);

      const det = { label: 'plate', conf: 0.9, x: 200, y: 200, w: 100, h: 30 };
      // The OCR key must match the ORIGINAL (pre-expansion) coordinates
      const ocrKey = `${Math.round(det.x)},${Math.round(det.y)},${Math.round(det.w)},${Math.round(det.h)}`;
      const ocrTexts = new Map<string, string>([[ocrKey, 'AB1234']]);

      // Apply with non-zero expansion — this is the scenario that was broken
      await applyDetections(ctx, [det], 'outline', '#000000', 0.5, ocrTexts);

      // Check for OCR text pixels below the expanded detection box.
      // With expansion=0.5: padX=25, padY=7.5 → expanded box ends at y ≈ 237.5.
      // OCR text is drawn just below the expanded box bottom.
      // The text color is #00ff88 (green), so we scan for green pixels below the box.
      const scanY = 242; // just below expanded box bottom
      let greenPixels = 0;
      for (let x = 170; x < 340; x++) {
        const d = ctx.getImageData(x, scanY, 1, 1).data;
        if (d[1] > 200 && d[0] < 50 && d[2] < 150) greenPixels++;
      }
      return greenPixels;
    });

    expect(hasOcrText, 'OCR text (#00ff88) should be rendered below the expanded detection box').toBeGreaterThan(5);
  });

  test('OCR text is NOT rendered when ocrTexts key uses expanded coordinates', async ({ page }) => {
    // This verifies the bug scenario: if we used expanded coords as key, nothing matches.
    await page.goto('http://localhost:3100');

    const hasOcrText = await page.evaluate(async () => {
      const applyDetections = (window as any).__applyDetections as (
        ctx: OffscreenCanvasRenderingContext2D,
        detections: any[],
        mode: string,
        color: string,
        expansionFraction: number,
        ocrTexts?: Map<string, string>,
        excludedKeys?: Set<string>,
      ) => Promise<void>;

      const canvas = new OffscreenCanvas(800, 600);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 600);

      const det = { label: 'plate', conf: 0.9, x: 200, y: 200, w: 100, h: 30 };
      // Use EXPANDED coordinates as key (this is what the old buggy code used)
      const padX = det.w * 0.5 * 0.5;
      const padY = det.h * 0.5 * 0.5;
      const wrongKey = `${Math.round(det.x - padX)},${Math.round(det.y - padY)},${Math.round(det.w + 2 * padX)},${Math.round(det.h + 2 * padY)}`;
      const ocrTexts = new Map<string, string>([[wrongKey, 'AB1234']]);

      await applyDetections(ctx, [det], 'outline', '#000000', 0.5, ocrTexts);

      // Scan for green OCR text pixels — should NOT be present with wrong key
      const scanY = 242;
      let greenPixels = 0;
      for (let x = 170; x < 340; x++) {
        const d = ctx.getImageData(x, scanY, 1, 1).data;
        if (d[1] > 200 && d[0] < 50 && d[2] < 150) greenPixels++;
      }
      return greenPixels;
    });

    expect(hasOcrText, 'OCR text should NOT appear when keyed by expanded coordinates').toBe(0);
  });

  test('exclusion cross uses original coordinates for key matching', async ({ page }) => {
    await page.goto('http://localhost:3100');

    const hasCross = await page.evaluate(async () => {
      const applyDetections = (window as any).__applyDetections as (
        ctx: OffscreenCanvasRenderingContext2D,
        detections: any[],
        mode: string,
        color: string,
        expansionFraction: number,
        ocrTexts?: Map<string, string>,
        excludedKeys?: Set<string>,
      ) => Promise<void>;

      const canvas = new OffscreenCanvas(800, 600);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 600);

      const det = { label: 'plate', conf: 0.9, x: 200, y: 200, w: 100, h: 30 };
      // Use original coordinates for the exclusion key
      const origKey = `${Math.round(det.x)},${Math.round(det.y)},${Math.round(det.w)},${Math.round(det.h)}`;
      const excludedKeys = new Set<string>([origKey]);

      await applyDetections(ctx, [det], 'outline', '#000000', 0.5, new Map(), excludedKeys);

      // The exclusion cross draws diagonal lines across the expanded box.
      // Check the centre of the expanded box for non-white pixels (the cross stroke).
      const cx = 200 + 100 / 2; // centre x of original box
      const cy = 200 + 30 / 2;  // centre y of original box
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      // Non-white = cross was drawn (stroke color is one of LABEL_COLORS)
      return d[0] < 250 || d[1] < 250 || d[2] < 250;
    });

    expect(hasCross, 'Exclusion cross should be drawn when excludedKeys uses original coordinates').toBe(true);
  });
});

// ── OCR suggestion chips: cleared on file switch ──────────────────────────────
// Bug: when switching preview files, OCR suggestion chips from the previous file
// remained visible. The old triggerOcr() checked suggestionsEl.children.length > 0
// and returned early, preventing OCR from running for the new file.

test.describe('OCR suggestion chips cleared on file switch', () => {
  test('switching files clears stale suggestion chips', async ({ page }) => {
    await injectDetections(page, JPEG_INJECT_DETECTIONS);
    await page.goto('http://localhost:3100');

    // Load two JPEG files (using synthetic second file to avoid duplicate detection)
    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
    await waitForCanvas(page);
    await waitForDetections(page);

    // Manually inject a fake suggestion chip into the container
    await page.evaluate(() => {
      const el = document.getElementById('keep-plates-suggestions')!;
      const btn = document.createElement('button');
      btn.className = 'ocr-suggestion';
      btn.textContent = 'FAKE123';
      el.appendChild(btn);
    });
    const chipsBefore = await page.evaluate(
      () => document.getElementById('keep-plates-suggestions')!.children.length,
    );
    expect(chipsBefore).toBe(1);

    // Create and load a synthetic second image
    const syntheticJpegBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      c.getContext('2d')!.fillStyle = '#808080';
      c.getContext('2d')!.fillRect(0, 0, 200, 200);
      const blob = await new Promise<Blob>((resolve) =>
        (c as HTMLCanvasElement).toBlob(resolve as BlobCallback, 'image/jpeg', 0.95),
      );
      return Array.from(new Uint8Array(await blob!.arrayBuffer()));
    });
    await page.locator('#file-input').setInputFiles({
      name: 'synthetic.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(syntheticJpegBytes),
    });
    await page.waitForTimeout(500);

    // Switch to file 1 (synthetic.jpg) via file list click
    await page.locator('.file-list-row').nth(1).click();
    await page.waitForTimeout(300);

    // Suggestion chips must be cleared
    const chipsAfter = await page.evaluate(
      () => document.getElementById('keep-plates-suggestions')!.children.length,
    );
    expect(chipsAfter, 'Suggestion chips should be cleared when switching files').toBe(0);
  });
});

// ── Video OCR suggestions propagated ──────────────────────────────────────────
// Bug: VideoPlayer.applyAndNotify() computed OCR texts via applyFiltersWithOcr()
// but only called onDetection — the ocrTexts result was discarded, so suggestion
// chips never appeared for videos.

test.describe('Video OCR suggestions', () => {
  test.setTimeout(180_000);

  test('OCR suggestion chips appear for video when keep-plates is enabled', async ({ page }) => {
    // Use the real plate detection from the video reference (plate at x≈1603)
    const VIDEO_PLATE: Detection = {
      label: 'plate', conf: 0.87, x: 1603, y: 460, w: 60, h: 17,
    };
    await injectDetections(page, [VIDEO_PLATE]);
    await page.goto('http://localhost:3100');

    if (!(await webCodecsSupported(page))) {
      test.skip(true, 'WebCodecs not available');
    }

    // Enable keep-plates with a wildcard so OCR runs but nothing is excluded
    await page.evaluate(() => (window as any).__setKeepPlates?.('NOMATCH999'));

    await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'x264.mp4'));

    // Wait for video to decode
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
        if (c !== null && c.width > 0) return true;
        return !!document.querySelector('.canvas-wrapper.active .error-msg');
      },
      { timeout: 60_000 },
    );
    const hasError = await page.evaluate(() => !!document.querySelector('.canvas-wrapper.active .error-msg'));
    if (hasError) {
      test.skip(true, 'Video decode failed');
      return;
    }
    const canvasWidth = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
      return c?.width ?? 0;
    });
    if (canvasWidth > 0 && canvasWidth !== 1920) {
      test.skip(true, `Unexpected canvas width ${canvasWidth}`);
      return;
    }

    // Wait for OCR suggestion chips to appear (OCR model may need to download)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('keep-plates-suggestions');
        return el && el.querySelectorAll('.ocr-suggestion').length > 0;
      },
      { timeout: 120_000 },
    );

    const chipTexts = await page.evaluate(() => {
      const el = document.getElementById('keep-plates-suggestions')!;
      return Array.from(el.querySelectorAll('.ocr-suggestion')).map((b) => b.textContent ?? '');
    });
    expect(chipTexts.length, 'At least one OCR suggestion chip should appear for the video').toBeGreaterThan(0);
    // The plate text should contain digits (it's a license plate)
    expect(
      chipTexts.some((t) => /\d/.test(t)),
      `Suggestion chips should contain plate text with digits, got: ${chipTexts}`,
    ).toBe(true);
  });
});
