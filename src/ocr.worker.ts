/**
 * Web Worker — runs PaddleOCR English recognition inference off the main thread.
 *
 * Protocol:
 *  Main → Worker  { type:'init', modelUrl: string, dictUrl: string }
 *  Worker → Main  { type:'ready' }
 *
 *  Main → Worker  { type:'recognize', id: number,
 *                   pixels: ArrayBuffer (transferred), width: number, height: number }
 *  Worker → Main  { type:'result', id: number, text: string }
 *
 *  Worker → Main  { type:'error', message: string }
 */

import * as ort from 'onnxruntime-web';

ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;

// Relay uncaught errors to main thread.
self.addEventListener('error', (e: ErrorEvent) => {
  self.postMessage({ type: 'error', message: `uncaught: ${e.message} (${e.filename}:${e.lineno})` });
});
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  self.postMessage({ type: 'error', message: `unhandled rejection: ${String(e.reason)}` });
});

// ── Constants ────────────────────────────────────────────────────────────────

const REC_HEIGHT = 48;

// ── State ────────────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let dictionary: string[] = []; // index → character
let blankIdx = 0; // CTC blank token index (= dict length)
let resolvedEps: string[] | null = null;

// ── EP probing ───────────────────────────────────────────────────────────────

async function resolveEps(): Promise<string[]> {
  if (resolvedEps !== null) return resolvedEps;
  const eps: string[] = [];
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = (
        navigator as unknown as {
          gpu: { requestAdapter(opts: object): Promise<{ requestDevice(): Promise<GPUDevice> } | null> };
        }
      ).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        ort.env.webgpu.device = (await adapter.requestDevice()) as unknown as GPUDevice;
        eps.push('webgpu');
      }
    } catch {
      /* skip */
    }
  }
  eps.push('wasm');
  resolvedEps = eps;
  return eps;
}

// ── Session management ───────────────────────────────────────────────────────

async function createSession(modelUrl: string): Promise<void> {
  if (session) {
    await (session as ort.InferenceSession & { release?(): Promise<void> }).release?.();
    session = null;
  }
  const eps = await resolveEps();
  console.log('[ocr worker] execution providers:', eps);
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session = await ort.InferenceSession.create(modelUrl as any, { executionProviders: subset });
      console.log(`[ocr worker] session created EPs: ${subset.join(', ')}`);
      return;
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[ocr worker] EP "${eps[i]}" failed:`, err);
      else throw err;
    }
  }
  throw new Error('No working execution provider');
}

// ── Det model ───────────────────────────────────────────────────────────────

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const DET_BINARIZE_THRESH = 0.3;
const DET_BOX_THRESH = 0.25;
const DET_MIN_COMPONENT_PX = 20;
const DET_MIN_RECT_SIDE = 3;
const DET_MIN_INPUT_SIDE = 64;
const DET_MAX_INPUT_SIDE = 960;
const DET_SKIP_ANGLE_RAD = 2 * Math.PI / 180;

let detSession: ort.InferenceSession | null = null;

async function createDetSession(modelUrl: string): Promise<void> {
  const eps = await resolveEps();
  for (let i = 0; i < eps.length; i++) {
    const subset = eps.slice(i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detSession = await ort.InferenceSession.create(modelUrl as any, { executionProviders: subset });
      console.log(`[ocr worker] det session created EPs: ${subset.join(', ')}`);
      return;
    } catch (err) {
      if (i < eps.length - 1) console.warn(`[ocr worker] det EP "${eps[i]}" failed:`, err);
      else console.warn(`[ocr worker] det model load failed:`, err);
    }
  }
}

async function loadDictionary(dictUrl: string): Promise<void> {
  const res = await fetch(dictUrl);
  if (!res.ok) throw new Error(`Failed to fetch dictionary: HTTP ${res.status}`);
  const text = await res.text();
  // monkt/paddleocr-onnx dict format: one character per line.
  // PaddleOCR CTC convention: blank token at index 0, characters at indices 1..N.
  // Prepend an empty entry so dict[0] = blank, dict[1] = first char, etc.
  dictionary = [''];
  for (const line of text.split('\n')) {
    if (line.length > 0) dictionary.push(line);
  }
  blankIdx = 0;
  console.log(`[ocr worker] dictionary loaded: ${dictionary.length - 1} chars, blank=${blankIdx}`);
}

// ── Preprocessing ────────────────────────────────────────────────────────────

function buildTensor(pixels: Uint8ClampedArray, width: number, height: number): ort.Tensor {
  // Input is RGBA pixels at the target size (height=48, width=variable).
  // Output: [1, 3, height, width] float32 normalized to [0, 1].
  // This model uses simple /255 normalization (NOT ImageNet mean/std).
  const c = 3;
  const tensor = new Float32Array(c * height * width);
  const pixelCount = height * width;
  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = pixels[i * 4] / 255;
    tensor[pixelCount + i] = pixels[i * 4 + 1] / 255;
    tensor[pixelCount * 2 + i] = pixels[i * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', tensor, [1, c, height, width]);
}

// ── Geometry utilities (DB text detection postprocessing) ────────────────────

function cross2d(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Andrew's monotone chain convex hull. Returns vertices in CCW order. */
function convexHull(points: [number, number][]): [number, number][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = sorted.length;
  if (n <= 2) return sorted;
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2d(...lower[lower.length - 2], ...lower[lower.length - 1], ...p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross2d(...upper[upper.length - 2], ...upper[upper.length - 1], ...sorted[i]) <= 0) upper.pop();
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface MinRect {
  cx: number; cy: number;
  w: number; h: number;
  angle: number;
}

/** Find the minimum-area bounding rectangle of a convex hull via rotating calipers. */
function minAreaRect(hull: [number, number][]): MinRect {
  const n = hull.length;
  if (n < 2) {
    const p: [number, number] = [hull[0]?.[0] ?? 0, hull[0]?.[1] ?? 0];
    return { cx: p[0], cy: p[1], w: 0, h: 0, angle: 0 };
  }

  let bestArea = Infinity;
  let bestAngle = 0;
  let bestXMin = 0, bestXMax = 0, bestYMin = 0, bestYMax = 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = hull[j][0] - hull[i][0];
    const ey = hull[j][1] - hull[i][1];
    if (Math.hypot(ex, ey) === 0) continue;

    const angle = Math.atan2(ey, ex);
    const c = Math.cos(-angle), s = Math.sin(-angle);

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const [px, py] of hull) {
      const rx = px * c - py * s;
      const ry = px * s + py * c;
      if (rx < xMin) xMin = rx; if (rx > xMax) xMax = rx;
      if (ry < yMin) yMin = ry; if (ry > yMax) yMax = ry;
    }

    const area = (xMax - xMin) * (yMax - yMin);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
      bestXMin = xMin; bestXMax = xMax;
      bestYMin = yMin; bestYMax = yMax;
    }
  }

  const ca = Math.cos(bestAngle), sa = Math.sin(bestAngle);
  const rcx = (bestXMin + bestXMax) / 2, rcy = (bestYMin + bestYMax) / 2;

  return {
    cx: rcx * ca - rcy * sa,
    cy: rcx * sa + rcy * ca,
    w: bestXMax - bestXMin,
    h: bestYMax - bestYMin,
    angle: bestAngle,
  };
}

/** Mean probability inside the convex hull polygon (scanline fill). */
function boxScore(prob: Float32Array, mapW: number, mapH: number, hull: [number, number][]): number {
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of hull) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const y0 = Math.max(0, Math.floor(yMin));
  const y1 = Math.min(mapH - 1, Math.ceil(yMax));
  const n = hull.length;
  let sum = 0, count = 0;

  for (let y = y0; y <= y1; y++) {
    // Find x-intersections of horizontal scanline with polygon edges
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1h, y1h] = hull[i];
      const [x2h, y2h] = hull[(i + 1) % n];
      if ((y1h <= y && y2h > y) || (y2h <= y && y1h > y)) {
        xs.push(x1h + (y - y1h) / (y2h - y1h) * (x2h - x1h));
      }
    }
    xs.sort((a, b) => a - b);
    // Fill between pairs of intersections
    for (let p = 0; p + 1 < xs.length; p += 2) {
      const xStart = Math.max(0, Math.floor(xs[p]));
      const xEnd = Math.min(mapW - 1, Math.ceil(xs[p + 1]));
      for (let x = xStart; x <= xEnd; x++) {
        sum += prob[y * mapW + x];
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Find connected components in a binary image using flood fill. */
function findComponents(binary: Uint8Array, w: number, h: number): [number, number][][] {
  const visited = new Uint8Array(w * h);
  const result: [number, number][][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (binary[idx] && !visited[idx]) {
        const comp: [number, number][] = [];
        const stack = [x, y];
        visited[idx] = 1;
        while (stack.length > 0) {
          const cy = stack.pop()!;
          const cx = stack.pop()!;
          comp.push([cx, cy]);
          if (cx > 0     && binary[cy * w + cx - 1]      && !visited[cy * w + cx - 1])      { visited[cy * w + cx - 1] = 1;      stack.push(cx - 1, cy); }
          if (cx < w - 1 && binary[cy * w + cx + 1]      && !visited[cy * w + cx + 1])      { visited[cy * w + cx + 1] = 1;      stack.push(cx + 1, cy); }
          if (cy > 0     && binary[(cy - 1) * w + cx]     && !visited[(cy - 1) * w + cx])     { visited[(cy - 1) * w + cx] = 1;     stack.push(cx, cy - 1); }
          if (cy < h - 1 && binary[(cy + 1) * w + cx]     && !visited[(cy + 1) * w + cx])     { visited[(cy + 1) * w + cx] = 1;     stack.push(cx, cy + 1); }
        }
        if (comp.length >= DET_MIN_COMPONENT_PX) result.push(comp);
      }
    }
  }
  return result;
}

// ── Text detection pipeline ─────────────────────────────────────────────────

interface DetResult {
  angle: number;
}

async function runDetection(pixels: Uint8ClampedArray, width: number, height: number, debug: boolean): Promise<DetResult | null> {
  if (!detSession) {
    if (debug) console.log('[ocr worker] det: no det session loaded, skipping');
    return null;
  }

  // Scale so min side >= DET_MIN_INPUT_SIDE, max side <= DET_MAX_INPUT_SIDE
  let scale = 1;
  if (Math.min(width, height) < DET_MIN_INPUT_SIDE) scale = DET_MIN_INPUT_SIDE / Math.min(width, height);
  if (Math.max(width, height) * scale > DET_MAX_INPUT_SIDE) scale = DET_MAX_INPUT_SIDE / Math.max(width, height);
  const sW = Math.round(width * scale);
  const sH = Math.round(height * scale);
  const padW = Math.ceil(sW / 32) * 32;
  const padH = Math.ceil(sH / 32) * 32;

  if (debug) console.log(`[ocr worker] det: input ${width}×${height} → scaled ${sW}×${sH} → padded ${padW}×${padH} (scale=${scale.toFixed(3)})`);

  // Resize via OffscreenCanvas
  const srcCanvas = new OffscreenCanvas(width, height);
  srcCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), width, height), 0, 0);
  const padCanvas = new OffscreenCanvas(padW, padH);
  const padCtx = padCanvas.getContext('2d')!;
  padCtx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, sW, sH);
  const rgba = padCtx.getImageData(0, 0, padW, padH).data;

  // Build normalized CHW tensor (ImageNet mean/std)
  const pc = padH * padW;
  const t = new Float32Array(3 * pc);
  for (let i = 0; i < pc; i++) {
    t[i]          = (rgba[i * 4]     / 255 - DET_MEAN[0]) / DET_STD[0];
    t[pc + i]     = (rgba[i * 4 + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
    t[pc * 2 + i] = (rgba[i * 4 + 2] / 255 - DET_MEAN[2]) / DET_STD[2];
  }

  const t0 = performance.now();
  const inTensor = new ort.Tensor('float32', t, [1, 3, padH, padW]);
  const res = await detSession.run({ [detSession.inputNames[0]]: inTensor });
  const prob = res[detSession.outputNames[0]].data as Float32Array;
  const detMs = performance.now() - t0;

  // DB postprocess: binarize → connected components → minAreaRect → score filter
  const bin = new Uint8Array(padW * padH);
  for (let i = 0; i < padW * padH; i++) bin[i] = prob[i] > DET_BINARIZE_THRESH ? 1 : 0;

  const comps = findComponents(bin, padW, padH);
  if (debug) console.log(`[ocr worker] det: inference ${detMs.toFixed(0)}ms, ${comps.length} component(s) above ${DET_MIN_COMPONENT_PX}px`);
  if (comps.length === 0) return null;

  let bestResult: DetResult | null = null;
  let bestScore = 0;
  let bestHull: [number, number][] | null = null;
  let bestRect: MinRect | null = null;
  for (let ci = 0; ci < comps.length; ci++) {
    const comp = comps[ci];
    const hull = convexHull(comp);
    if (hull.length < 3) continue;
    const rect = minAreaRect(hull);
    if (Math.min(rect.w, rect.h) < DET_MIN_RECT_SIDE) {
      if (debug) console.log(`[ocr worker] det:   comp[${ci}] ${comp.length}px → rect ${rect.w.toFixed(0)}×${rect.h.toFixed(0)} — too small, skip`);
      continue;
    }
    const score = boxScore(prob, padW, padH, hull);
    if (debug) console.log(`[ocr worker] det:   comp[${ci}] ${comp.length}px → rect ${rect.w.toFixed(0)}×${rect.h.toFixed(0)} angle=${(rect.angle * 180 / Math.PI).toFixed(1)}° score=${score.toFixed(3)}`);
    if (score < DET_BOX_THRESH) continue;

    if (score > bestScore) {
      bestScore = score;
      bestRect = rect;
      bestHull = hull;
    }
  }

  if (bestRect) {
    let tw = bestRect.w, th = bestRect.h, ta = bestRect.angle;
    // Ensure width > height (text is wider than tall)
    if (tw < th) {
      [tw, th] = [th, tw];
      ta += Math.PI / 2;
    }
    // Normalize angle to [-π/2, π/2]
    while (ta > Math.PI / 2) ta -= Math.PI;
    while (ta < -Math.PI / 2) ta += Math.PI;
    bestResult = { angle: ta };
  }

  if (debug) {
    if (bestResult) console.log(`[ocr worker] det: best → angle=${(bestResult.angle * 180 / Math.PI).toFixed(1)}° score=${bestScore.toFixed(3)}`);
    else console.log(`[ocr worker] det: no text region passed filters`);

    // Draw input crop with hull overlay at 4× size for visibility
    if (bestHull) {
      const Z = 4;
      const dbgCanvas = new OffscreenCanvas(width * Z, height * Z);
      const dbgCtx = dbgCanvas.getContext('2d')!;
      dbgCtx.imageSmoothingEnabled = false;
      const srcImg = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), width, height);
      const tmpCanvas = new OffscreenCanvas(width, height);
      tmpCanvas.getContext('2d')!.putImageData(srcImg, 0, 0);
      dbgCtx.drawImage(tmpCanvas, 0, 0, width * Z, height * Z);
      // Draw det hull in green
      dbgCtx.strokeStyle = '#00ff00';
      dbgCtx.lineWidth = 2;
      dbgCtx.beginPath();
      dbgCtx.moveTo(bestHull[0][0] / scale * Z, bestHull[0][1] / scale * Z);
      for (let i = 1; i < bestHull.length; i++) dbgCtx.lineTo(bestHull[i][0] / scale * Z, bestHull[i][1] / scale * Z);
      dbgCtx.closePath();
      dbgCtx.stroke();
      dbgCanvas.convertToBlob({ type: 'image/png' }).then((blob) => {
        self.postMessage({ type: 'debug-image', label: `det hull ${width}×${height} (4×)`, blob });
      }).catch(() => {});
    }
  }
  return bestResult;
}

// ── Deskew + recognize ──────────────────────────────────────────────────────

/** Resize a crop to REC_HEIGHT × proportional width and run rec model. */
async function recOnCrop(pixels: Uint8ClampedArray, w: number, h: number): Promise<string> {
  if (!session) throw new Error('Session not initialized');
  const tgtH = REC_HEIGHT;
  const tgtW = Math.min(320, Math.max(1, Math.round(w * tgtH / h)));
  const srcBitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), w, h));
  const rc = new OffscreenCanvas(tgtW, tgtH);
  const rctx = rc.getContext('2d')!;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(srcBitmap, 0, 0, w, h, 0, 0, tgtW, tgtH);
  srcBitmap.close();
  const resized = rctx.getImageData(0, 0, tgtW, tgtH).data;
  const inputTensor = buildTensor(resized, tgtW, tgtH);
  const results = await session.run({ [session.inputNames[0]]: inputTensor });
  return ctcDecode(results[session.outputNames[0]]);
}

/** Run det to find text rotation, rotate crop, then run rec. Falls back to direct rec. */
async function deskewAndRecognize(pixels: Uint8ClampedArray, w: number, h: number, debug: boolean): Promise<string> {
  const det = await runDetection(pixels, w, h, debug);

  // No text detected or angle is negligible → run rec on original crop
  if (!det || Math.abs(det.angle) < DET_SKIP_ANGLE_RAD) {
    if (debug) console.log(`[ocr worker] deskew: ${det ? `angle ${(det.angle * 180 / Math.PI).toFixed(1)}° below threshold` : 'no det result'} — using original crop ${w}×${h}`);
    const text = await recOnCrop(pixels, w, h);
    if (debug) console.log(`[ocr worker] rec: "${text}" (from original ${w}×${h})`);
    return text;
  }

  const angle = det.angle;
  const angleDeg = (angle * 180 / Math.PI).toFixed(1);

  // Rotate the full crop by -angle around its center using OffscreenCanvas.
  // Size the output to the rotated bounding box so nothing is clipped.
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const rotW = Math.ceil(w * cos + h * sin);
  const rotH = Math.ceil(w * sin + h * cos);
  const srcBitmap = await createImageBitmap(
    new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length), w, h),
  );
  const rotCanvas = new OffscreenCanvas(rotW, rotH);
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate(-angle);
  rotCtx.drawImage(srcBitmap, -w / 2, -h / 2);
  srcBitmap.close();
  const rotated = rotCtx.getImageData(0, 0, rotW, rotH);
  console.log(`[ocr worker] deskew: rotate ${angleDeg}° ${w}×${h} → ${rotW}×${rotH}`);

  if (debug) {
    const dbgCanvas = new OffscreenCanvas(rotW, rotH);
    dbgCanvas.getContext('2d')!.putImageData(rotated, 0, 0);
    dbgCanvas.convertToBlob({ type: 'image/png' }).then((blob) => {
      self.postMessage({ type: 'debug-image', label: `rotated ${rotW}×${rotH} angle=${angleDeg}°`, blob });
    }).catch((err) => { console.warn('[ocr worker] debug-image failed:', err); });
  }

  const text = await recOnCrop(rotated.data, rotW, rotH);
  if (debug) console.log(`[ocr worker] rec: "${text}" (from rotated ${rotW}×${rotH})`);
  return text;
}

// ── CTC decode ───────────────────────────────────────────────────────────────

function ctcDecode(output: ort.Tensor): string {
  const data = output.data as Float32Array;
  const [, seqLen, vocabSize] = output.dims as [number, number, number];
  let prev = -1;
  const chars: string[] = [];
  for (let t = 0; t < seqLen; t++) {
    // Argmax over vocabulary at timestep t
    let maxIdx = 0;
    let maxVal = data[t * vocabSize];
    for (let v = 1; v < vocabSize; v++) {
      const val = data[t * vocabSize + v];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = v;
      }
    }
    // CTC collapse: skip blank and consecutive duplicates
    if (maxIdx !== blankIdx && maxIdx !== prev) {
      const ch = dictionary[maxIdx] ?? '';
      chars.push(ch);
    }
    prev = maxIdx;
  }
  // Filter to A-Z 0-9 ÄÖÜ only (license plate characters)
  return chars.filter((c) => /^[A-ZÄÖÜ0-9]$/i.test(c)).join('').toUpperCase();
}

// ── Message handler ──────────────────────────────────────────────────────────

// Serialize all message processing so only one session.run() is active at a
// time.  The ONNX WebGPU backend throws "Session already started" when
// concurrent runs hit the same session.
let taskQueue: Promise<void> = Promise.resolve();

async function handleMessage(msg: Record<string, unknown>): Promise<void> {
  try {
    if (msg.type === 'init') {
      await loadDictionary(msg.dictUrl as string);
      await createSession(msg.modelUrl as string);
      if (msg.detModelUrl) await createDetSession(msg.detModelUrl as string);
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'recognize') {
      if (!session) throw new Error('Session not initialized');
      const pixels = new Uint8ClampedArray(msg.pixels as ArrayBuffer);
      const inputTensor = buildTensor(pixels, msg.width as number, msg.height as number);
      const inputName = session.inputNames[0];
      const results = await session.run({ [inputName]: inputTensor });
      const outputName = session.outputNames[0];
      const text = ctcDecode(results[outputName]);
      self.postMessage({ type: 'result', id: msg.id, text });
    } else if (msg.type === 'detect-and-recognize') {
      if (!session) throw new Error('Session not initialized');
      const drPixels = new Uint8ClampedArray(msg.pixels as ArrayBuffer);
      const drDebug = !!msg.debug;
      const drText = await deskewAndRecognize(drPixels, msg.width as number, msg.height as number, drDebug);
      self.postMessage({ type: 'result', id: msg.id, text: drText });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ocr worker] error:`, err);
    if (msg.type === 'recognize' || msg.type === 'detect-and-recognize') {
      self.postMessage({ type: 'error', id: msg.id, message });
    } else {
      self.postMessage({ type: 'error', message });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  taskQueue = taskQueue.then(() => handleMessage(e.data));
};
