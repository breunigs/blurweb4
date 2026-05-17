# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media.test.ts >> JPEG export — EXIF preservation >> exported JPEG strips EXIF when keepMetadata=strip
- Location: tests/media.test.ts:166:3

# Error details

```
Error: page.waitForFunction: Test ended.
```

# Test source

```ts
  383 | 
  384 |     test('exported file duration within 0.1 s of source', async ({ page }) => {
  385 |       const inputPath = path.join(EXAMPLES, file);
  386 |       const inputDuration = ffprobeDuration(inputPath);
  387 | 
  388 |       await loadFile(page, inputPath);
  389 | 
  390 |       if (!(await webCodecsSupported(page))) {
  391 |         test.skip(true, 'WebCodecs not available');
  392 |       }
  393 | 
  394 |       // Wait for the first frame so the player is fully initialised.
  395 |       const firstFrameWait = wasmFallback ? 90_000 : 45_000;
  396 |       await page.waitForFunction(
  397 |         () => {
  398 |           const c = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas[data-loaded="true"]');
  399 |           return c !== null && c.width > 0;
  400 |         },
  401 |         { timeout: firstFrameWait },
  402 |       );
  403 | 
  404 |       // Wait for the first-frame background inference to complete and warm the
  405 |       // cache before export starts.  This avoids running inference twice for
  406 |       // frame 0 (once in background, once during export) and ensures the export
  407 |       // only needs inference for frames 1..N-1 rather than 0..N-1.
  408 |       await waitForDetections(page, wasmFallback ? 90_000 : 45_000);
  409 | 
  410 |       // Intercept the download triggered by the Export button.
  411 |       const exportWait = wasmFallback ? 1_700_000 : 1_100_000;
  412 |       const downloadPromise = page.waitForEvent('download', { timeout: exportWait });
  413 |       await page.locator('#export-btn').click();
  414 |       const download = await downloadPromise;
  415 | 
  416 |       // Save to a temp path and measure with ffprobe.
  417 |       const tmpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `../.tmp-${file}`);
  418 |       await download.saveAs(tmpPath);
  419 | 
  420 |       let outputDuration: number;
  421 |       let hasVideoStream: boolean;
  422 |       try {
  423 |         outputDuration = ffprobeDuration(tmpPath);
  424 |         hasVideoStream = ffprobeHasVideo(tmpPath);
  425 |       } finally {
  426 |         import('fs').then((fs) => fs.unlinkSync(tmpPath)).catch(() => {});
  427 |       }
  428 | 
  429 |       expect(hasVideoStream, 'Exported file must contain a video stream').toBe(true);
  430 |       expect(
  431 |         Math.abs(outputDuration - inputDuration),
  432 |         `Output duration ${outputDuration.toFixed(3)} s differs from input ${inputDuration.toFixed(3)} s by more than 0.1 s`,
  433 |       ).toBeLessThanOrEqual(0.1);
  434 |     });
  435 |   });
  436 | }
  437 | 
  438 | // ── Object detection ─────────────────────────────────────────────────────────
  439 | // Cross-browser: Chromium and Firefox produce identical results (deterministic WASM inference).
  440 | 
  441 | interface RefDetection {
  442 |   label: string;
  443 |   conf_min: number;
  444 |   x: number;
  445 |   y: number;
  446 |   w: number;
  447 |   h: number;
  448 | }
  449 | 
  450 | // Reference detections for examples/jpeg.jpg (iPhone 12 mini photo, 1536×2048).
  451 | // With letterbox preprocessing the model now finds 3 plates (matches PyTorch output).
  452 | const JPEG_REF_DETECTIONS: RefDetection[] = [
  453 |   { label: 'plate', conf_min: 0.85, x: 479, y: 1588, w: 208, h: 51 },
  454 |   { label: 'plate', conf_min: 0.6, x: 54, y: 1377, w: 35, h: 10 },
  455 |   { label: 'plate', conf_min: 0.35, x: 253, y: 1365, w: 26, h: 8 },
  456 | ];
  457 | 
  458 | // Reference detections for the three test videos (all same road scene, display 2704×1521).
  459 | const VIDEO_REF_DETECTIONS: RefDetection[] = [
  460 |   { label: 'plate', conf_min: 0.87, x: 1715, y: 858, w: 67, h: 18 },
  461 |   { label: 'plate', conf_min: 0.76, x: 2618, y: 1096, w: 85, h: 62 },
  462 | ];
  463 | 
  464 | const BOX_TOL = 5; // pixels
  465 | 
  466 | function assertDetectionsMatch(actual: Detection[], ref: RefDetection[]): void {
  467 |   expect(actual.length, `expected ${ref.length} detections, got ${actual.length}: ${JSON.stringify(actual)}`).toBe(
  468 |     ref.length,
  469 |   );
  470 |   for (let i = 0; i < ref.length; i++) {
  471 |     const a = actual[i];
  472 |     const r = ref[i];
  473 |     expect(a.label, `detection[${i}] label`).toBe(r.label);
  474 |     expect(a.conf, `detection[${i}] conf`).toBeGreaterThanOrEqual(r.conf_min);
  475 |     expect(Math.abs(a.x - r.x), `detection[${i}] x: got ${a.x}, ref ${r.x}`).toBeLessThanOrEqual(BOX_TOL);
  476 |     expect(Math.abs(a.y - r.y), `detection[${i}] y: got ${a.y}, ref ${r.y}`).toBeLessThanOrEqual(BOX_TOL);
  477 |     expect(Math.abs(a.w - r.w), `detection[${i}] w: got ${a.w}, ref ${r.w}`).toBeLessThanOrEqual(BOX_TOL);
  478 |     expect(Math.abs(a.h - r.h), `detection[${i}] h: got ${a.h}, ref ${r.h}`).toBeLessThanOrEqual(BOX_TOL);
  479 |   }
  480 | }
  481 | 
  482 | async function waitForDetections(page: Page, timeoutMs = 60_000): Promise<Detection[]> {
> 483 |   await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__lastDetections !== undefined, {
      |              ^ Error: page.waitForFunction: Test ended.
  484 |     timeout: timeoutMs,
  485 |   });
  486 |   return page.evaluate(() => (window as unknown as Record<string, unknown>).__lastDetections as Detection[]);
  487 | }
  488 | 
  489 | test.describe('Object detection — JPEG first frame', () => {
  490 |   test('detections match reference', async ({ page }) => {
  491 |     await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
  492 |     await waitForCanvas(page);
  493 |     const detections = await waitForDetections(page);
  494 |     assertDetectionsMatch(detections, JPEG_REF_DETECTIONS);
  495 |   });
  496 | 
  497 |   // Actual confidences: ~0.90, ~0.67, ~0.43.
  498 |   // At 0.10 all three plates are shown; at 0.50 only the two high-conf ones pass.
  499 |   test('minConfidence=0.10 shows 3 plates', async ({ page }) => {
  500 |     await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
  501 |     await waitForCanvas(page);
  502 |     await waitForDetections(page);
  503 |     await page.evaluate(() => (window as any).__setMinConfidence(0.1));
  504 |     const detections = await waitForDetections(page);
  505 |     expect(detections.length).toBe(3);
  506 |   });
  507 | 
  508 |   test('minConfidence=0.50 shows 2 plates', async ({ page }) => {
  509 |     await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
  510 |     await waitForCanvas(page);
  511 |     await waitForDetections(page);
  512 |     await page.evaluate(() => (window as any).__setMinConfidence(0.5));
  513 |     const detections = await waitForDetections(page);
  514 |     expect(detections.length).toBe(2);
  515 |     expect(detections.every((d: any) => d.conf >= 0.5)).toBe(true);
  516 |   });
  517 | });
  518 | 
  519 | const DETECTION_VIDEO_CASES = [
  520 |   { file: 'x264.mp4', codec: 'H.264' },
  521 |   { file: 'av1.mp4', codec: 'AV1' },
  522 |   { file: 'x265.mp4', codec: 'H.265', wasmFallback: true },
  523 | ];
  524 | 
  525 | // ── Draw mode tests ───────────────────────────────────────────────────────────
  526 | // JPEG_REF_DETECTIONS[1] is a plate at approximately x=54, y=1377, w=35, h=10.
  527 | // Point (74, 1382) lies inside that box and is used as the sample coordinate.
  528 | 
  529 | test.describe('Draw modes', () => {
  530 |   // Load the JPEG, wait for outline-mode detections (default), then switch modes.
  531 |   test('blackout: detection centre is solid black', async ({ page }) => {
  532 |     await loadFile(page, path.join(EXAMPLES, 'jpeg.jpg'));
  533 |     await waitForCanvas(page);
  534 |     await waitForDetections(page);
  535 | 
  536 |     await page.evaluate(() => (window as any).__setDrawMode('blackout'));
  537 |     // Give the re-render a moment to complete (synchronous applyDetections call)
  538 |     await page.waitForTimeout(200);
  539 | 
  540 |     const pixel = await page.evaluate(() => {
  541 |       const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
  542 |       const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
  543 |       return [d[0], d[1], d[2]];
  544 |     });
  545 |     expect(pixel[0], `R channel at detection centre: ${pixel}`).toBeLessThan(10);
  546 |     expect(pixel[1], `G channel at detection centre: ${pixel}`).toBeLessThan(10);
  547 |     expect(pixel[2], `B channel at detection centre: ${pixel}`).toBeLessThan(10);
  548 |   });
  549 | 
  550 |   test('blur: detection region is visually blurred (not sharp)', async ({ page }) => {
  551 |     // Load in outline mode so we can capture the raw pixel under the detection box,
  552 |     // then switch to blur and verify the pixel changes.
  553 |     await page.goto('http://localhost:3100');
  554 |     // Force outline mode before loading so the initial render uses outline.
  555 |     await page.evaluate(() => (window as any).__setDrawMode?.('outline'));
  556 |     await page.locator('#file-input').setInputFiles(path.join(EXAMPLES, 'jpeg.jpg'));
  557 |     await waitForCanvas(page);
  558 |     await waitForDetections(page);
  559 |     await page.waitForTimeout(100); // let re-render complete
  560 | 
  561 |     // Capture baseline inside the plate box in outline mode (should show original pixels).
  562 |     const baseline = await page.evaluate(() => {
  563 |       const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
  564 |       const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
  565 |       return [d[0], d[1], d[2]];
  566 |     });
  567 | 
  568 |     // Switch to blur and wait for re-render.
  569 |     await page.evaluate(() => (window as any).__setDrawMode('blur'));
  570 |     await page.waitForTimeout(300);
  571 | 
  572 |     const blurred = await page.evaluate(() => {
  573 |       const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper.active canvas')!;
  574 |       const d = canvas.getContext('2d')!.getImageData(74, 1382, 1, 1).data;
  575 |       return [d[0], d[1], d[2]];
  576 |     });
  577 | 
  578 |     // Blur mixes surrounding pixels into the detection region — at least one channel must change.
  579 |     const changed = baseline.some((v, i) => Math.abs(v - blurred[i]) > 5);
  580 |     expect(changed, `Blur had no effect: baseline=${baseline} blurred=${blurred}`).toBe(true);
  581 |   });
  582 | });
  583 | 
```