# CLAUDE.md — project notes for AI assistants

## Project layout

```
blurweb4/
├── build.mjs             esbuild dev server + production build script
├── index.html            app shell (drop zone, tab bar, canvas, video controls)
├── src/
│   ├── main.ts           entry point — registers decoders, instantiates App
│   ├── app.ts            file handling, tab management, control wiring
│   ├── imageRenderer.ts  createImageBitmap → canvas (renders bitmap only, no detection)
│   ├── videoPlayer.ts    mediabunny VideoSampleSink wrapper with play/pause/seek
│   ├── hevcDecoder.ts    libav.js WASM fallback decoder for HEVC (registered at startup)
│   ├── softwareDecoder.ts  smart WebCodecs decoder with hw→sw→no-pref fallback chain
│   ├── libavVideoDecoder.ts  libav.js WASM fallback for AVC/AV1 (last resort)
│   ├── detector.ts       YOLOv5 ONNX inference, IDB cache, inference queue, drawing
│   ├── encoderConfig.ts  codec/hardware detection for export
│   ├── videoEncoder.ts   mediabunny Conversion-based re-encoder (bakes detections in)
│   ├── imageExporter.ts  canvas.toBlob → JPEG download
│   └── batchExporter.ts  sequential multi-file export with progress callbacks
├── models/
│   └── detect_n_2024_04.onnx   YOLOv5n model (~8 MB), labels: plate, person
├── vendor/
│   ├── libav-hevc/       pre-built libav.js hevc-aac WASM variant (not bundled by esbuild)
│   │   ├── libav-6.8.8.0-hevc-aac.wasm.mjs   ES module wrapper (~260 KB)
│   │   └── libav-6.8.8.0-hevc-aac.wasm.wasm  WASM binary (~2.2 MB)
│   └── libav-avc-av1/    libav.js AVC+AV1 WASM (build instructions in libavVideoDecoder.ts)
├── tests/
│   └── media.test.ts   Playwright tests (Chromium + Firefox)
├── playwright.config.ts
├── examples/           test media files (do not delete)
│   ├── jpeg.jpg        2704×1521 JPEG
│   ├── x264.mp4        2704×1520 coded, H.264, ~1 s
│   ├── x265.mp4        2704×1520 coded, H.265/HEVC, ~1 s
│   └── av1.mp4         2704×1520 coded, AV1, ~1 s
└── dist/               esbuild output (gitignore-worthy, not committed)
    ├── bundle.js
    └── ort/            onnxruntime-web WASM files (copied by build.mjs, not committed)
```

No framework. No CSS preprocessor. Vanilla TypeScript compiled by esbuild.

## mediabunny API

Package: `mediabunny`. Version pinned at `^1.44.2`.

### Creating an input

```typescript
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';

const input = new Input({
  formats: ALL_FORMATS,
  source: new BlobSource(file),  // file is a browser File object
});
```

### Getting a video track and decoding frames

```typescript
import { VideoSampleSink } from 'mediabunny';

const track = await input.getPrimaryVideoTrack();  // null if no video
const sink  = new VideoSampleSink(track);

// Single frame at a timestamp (seconds):
const sample = await sink.getSample(0);
if (sample) {
  sample.draw(ctx, 0, 0);  // draws to CanvasRenderingContext2D
  sample.close();           // MUST close to free VideoFrame memory
}

// Iterate all frames (async generator):
for await (const sample of sink.samples(startSec, endSec)) {
  sample.draw(ctx, 0, 0);
  sample.close();
}
```

### Key VideoSample properties

| Property | Type | Notes |
|---|---|---|
| `timestamp` | `number` | Presentation time in **seconds** (not microseconds) |
| `duration` | `number` | Frame duration in **seconds** |
| `displayWidth` | `number` | After SAR / aspect-ratio correction |
| `displayHeight` | `number` | After SAR / aspect-ratio correction |
| `codedWidth` | `number` | Raw coded dimensions (getter) |
| `codedHeight` | `number` | Raw coded dimensions (getter) |
| `microsecondTimestamp` | `number` | Convenience getter in µs |

Use `displayWidth`/`displayHeight` for canvas sizing — they account for
pixel aspect ratio. Do **not** use `codedWidth`/`codedHeight` for display.

### Getting duration

```typescript
// Fast — reads from container metadata (may be approximate):
const duration = await input.getDurationFromMetadata([track]);

// Slow — scans the entire file for precision:
const duration = await input.computeDuration([track]);
```

### Track dimensions (before decoding a frame)

```typescript
const w = await track.getCodedWidth();   // Promise<number>
const h = await track.getCodedHeight();  // Promise<number>
// Deprecated sync accessors also exist: track.codedWidth, track.codedHeight
```

### Cleanup

```typescript
input.dispose();  // frees all internal resources; aborts ongoing iterations
```

### Per-frame hook during export (Conversion.process)

`ConversionVideoOptions.process` intercepts each decoded frame before encoding:

```typescript
const conversion = await Conversion.init({
  input, output,
  video: {
    codec, hardwareAcceleration,
    process: async (sample: VideoSample): Promise<OffscreenCanvas> => {
      offscreen.draw(ctx, 0, 0);
      // ... transform pixels ...
      return offscreen;  // returned canvas is encoded in place of the original frame
    },
  },
  // audio: omitted → automatic passthrough
  tags: {},  // suppress metadata copy — proprietary tags (e.g. GoPro GPMF) break parsers
});
```

Audio is passed through automatically when no `audio:` options are specified.

**Metadata pitfall:** mediabunny copies input metadata tags to the output by default. For
GoPro files this includes ~25 KB of GPMF telemetry in a proprietary `ilst` format that
ffprobe and other parsers reject as invalid. The fix is to pass a `tags` function that
strips `Uint8Array` raw entries (binary blobs) while keeping harmless string fields like
GPS coordinates (`©xyz`):
```typescript
tags: (input) => {
  const { raw, ...rest } = input;
  const safeRaw: typeof raw = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v === 'string') safeRaw[k] = v;
  }
  return { ...rest, ...(Object.keys(safeRaw).length ? { raw: safeRaw } : {}) };
},
```

## WebCodecs hardware-acceleration fallback chain (src/softwareDecoder.ts)

`SmartWebCodecsDecoder` handles AVC, VP9, AV1, and VP8 (everything except HEVC).

**Startup probing:** At module load, `isConfigSupported()` is called for every
`(codec, hardwareAcceleration)` combination — `prefer-hardware`, `prefer-software`,
`no-preference` — for each codec.  Results are stored as `probe-ok` / `probe-fail`.

**Decoder selection in `init()`:** The first non-failed mode is tried using
`VideoDecoder.configure()`.  If configure transitions the decoder to a non-`configured`
state (or throws), the mode is marked `runtime-fail` and the next is tried.

**Runtime error recovery (the tricky part):**
`VideoDecoder.decode()` is fire-and-forget — errors arrive asynchronously via the
error callback, which closes the decoder (`state = 'closed'`).  Mediabunny detects
this by calling our `flush()` after queuing packets; our `await this.decoder.flush()`
then throws `InvalidStateError` because the decoder is closed.

The fix: buffer every `EncodedVideoChunk` in `pendingPackets` inside `decode()`.  In
`flush()`, if the flush fails (or `runtimeError` is already set / decoder already
closed), call `reinitWithNextMode()` then replay all buffered packets through the new
decoder and flush again.  `pendingPackets` is cleared only on a successful flush.

**libav.js ultimate fallback (src/libavVideoDecoder.ts):**
`LibavVideoFallbackDecoder` claims AVC and AV1 only when `areAllWebCodecsFailed(codec)`
returns true (exported from softwareDecoder.ts).  It also HEAD-checks the vendor WASM
at startup and will not activate if the file is absent.  Vendor files go in
`vendor/libav-avc-av1/` — see that file's header for build instructions.

**Registration order in main.ts matters:**
1. `hevcDecoder` — HEVC → always libav
2. `softwareDecoder` — AVC/VP9/AV1/VP8 → smart WebCodecs, checked first
3. `libavVideoDecoder` — AVC/AV1 → libav fallback, checked only if #2 returns false

## HEVC / H.265 support

WebCodecs HEVC decode is **not available on Linux** (neither Chromium nor
Firefox) as of 2025. The `x265.mp4` test file is therefore gracefully skipped
on Linux CI — the test detects a `.error-msg` in the DOM (set by the app on
decode failure) and calls `test.skip()`.

On macOS and Windows, HEVC is hardware-accelerated and should work — the
`HevcFallbackDecoder.supports()` guard returns `false` when native WebCodecs
handles HEVC, so the WASM path is never taken on those platforms.

## HEVC fallback decoder (src/hevcDecoder.ts)

The `HevcFallbackDecoder` class extends mediabunny's `CustomVideoDecoder`.

**How decoder selection works in mediabunny (important):**
Custom decoders are checked FIRST, before WebCodecs. mediabunny calls
`CustomDecoder.supports(codec, config)` and if it returns `true`, uses that
decoder. There is no automatic WebCodecs-first fallback. Therefore the
`supports()` method MUST return `false` when native WebCodecs can handle the
codec — otherwise the fallback always wins, even on platforms with HEVC support.

**Pre-check pattern:**
```typescript
// At module load time (async, non-blocking):
let hevcNativeOk: boolean | null = null;
VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L93.B0', ... })
  .then(r => { hevcNativeOk = r.supported === true; });

static supports(codec, _config) {
  return codec === 'hevc' && hevcNativeOk !== true;
}
```
`null` (check still pending) defaults to using the fallback — safe because the
check resolves in milliseconds and the user hasn't opened a file yet.

**Lazy WASM loading:**
The 2.2 MB WASM binary is only fetched on first use (inside `init()`). To
prevent esbuild from statically bundling the vendor files, the import path is
computed at runtime:
```typescript
const url = new URL(LIBAV_MJS, document.baseURI).href;
const { default: LibAVFactory } = await (new Function('u', 'return import(u)'))(url);
```
`new Function('u', 'return import(u)')` creates a function esbuild cannot
statically analyse. The `import.meta.url` inside the `.wasm.mjs` file then
resolves the WASM binary relative to the vendor directory.

**libav.js API used:**
```typescript
// Initialise with hvcC extradata from WebCodecs VideoDecoderConfig.description
[, c, pkt, frame] = await libav.ff_init_decoder('hevc', {
  codecpar: { codec_type: 0, codec_id: 173, format: -1, width, height, extradata },
  time_base: [1, 1_000_000],  // microseconds
});

// Decode one packet (mediabunny calls this in sequenceNumber order)
const frames = await libav.ff_decode_multi(c, pkt, frame, [{ data, pts, dts, flags }]);

// Flush buffered frames at end-of-stream
const frames = await libav.ff_decode_multi(c, pkt, frame, [], true);

// Cleanup
await libav.ff_free_decoder(c, pkt, frame);
```

**SAR computation in emitFrames:**
libav.js returns `frame.sample_aspect_ratio = [num, den]`. For the test videos
SAR = `[1520, 1521]` (pixels are slightly taller than wide). Apply it to derive
display dimensions matching the native WebCodecs output:
```typescript
if (aspect < 1) displayHeight = Math.round(h / aspect);  // → 1521
if (aspect > 1) displayWidth  = Math.round(w * aspect);
```
Pass `displayWidth` / `displayHeight` to the `VideoSample` constructor so
mediabunny reports the correct display size.

**Building the hevc-aac libav.js variant:**
The hevc-aac variant is NOT published to npm (MPEG patent reasons). Build it
from the source tarball inside the npm package:
```sh
mkdir /tmp/libavjs && tar xf node_modules/libav.js/sources/libav.js.tar.xz -C /tmp/libavjs
cp node_modules/libav.js/sources/*.tar.* /tmp/libavjs/
docker build -f /tmp/libavjs/Dockerfile.development -t libavjs-builder /tmp/libavjs
docker run --rm -v /tmp/libavjs:/work -w /work libavjs-builder make build-hevc-aac
# Copy output:
cp /tmp/libavjs/dist/libav-6.8.8.0-hevc-aac.wasm.{mjs,wasm} vendor/libav-hevc/
```

## WebCodecs requires a secure context

`VideoDecoder` (and the rest of WebCodecs) is `undefined` on `about:blank`
and other non-secure origins. It IS available on `http://localhost` (treated
as secure by browsers).

In Playwright tests this matters: check for WebCodecs support only **after**
navigating to the test server URL, not before. Checking on `about:blank`
will always return `undefined` and silently skip your tests.

## Canvas pixel dimensions vs. ffprobe

The test videos report `1520` lines in ffprobe, but mediabunny's
`sample.displayHeight` returns `1521`. This is expected: the display height
accounts for the sample aspect ratio (SAR) stored in the container, which
ffprobe reports separately from the coded height.

Always use `sample.displayWidth` / `sample.displayHeight` (not ffprobe
dimensions) when sizing canvases or writing pixel-exact test assertions.

## esbuild notes

- `build.mjs` is a plain ES module script (no Vite, no Webpack).
- Dev mode: `esbuild.context(...).serve({ servedir: '.' })` — serves the
  project root statically; requests for `dist/bundle.js` are intercepted and
  served from the in-memory build output.
- Prod mode: writes `dist/bundle.js` to disk, minified.
- esbuild handles TypeScript transpilation; `tsconfig.json` exists only for
  IDE type-checking (`"noEmit": true`).
- The bundle format is `esm`; `index.html` loads it with `<script type="module">`.
- Port is configurable via `PORT` env variable (default 3000 for dev).

## Running tests

```sh
mise exec -- npm test                        # both browsers (port 3100)
mise exec -- npm test -- --project=chromium  # single browser
mise exec -- npm test -- --grep "JPEG"       # single test
```

Tests run on **port 3100** to avoid conflicting with `npm run dev` (port 3000).
Playwright spawns the esbuild dev server automatically via `webServer` config
and reuses it if already running on port 3100.

## YOLOv5 object detection (src/detector.ts)

Model: `models/detect_n_2024_04.onnx` (8 MB, labels: `plate`, `person`).
Input: `[1, 3, 736, 1280]` float32 RGB CHW tensor normalized to [0, 1].
Output: `[1, N, 7]` — rows of `[cx, cy, w, h, obj_conf, plate_conf, person_conf]`
in model-pixel coordinates (0..1280, 0..736).

**Execution provider priority:** WebGPU → WebGL → WASM (probed at startup,
falls back to next on failure). All ONNX calls are **serialized** via a
promise chain (`onnxChain`) — concurrent `session.run()` calls cause issues
with WASM/WebGL runtimes.

**Background inference queue (preview path):**
- `scheduleInference(source, key, callback)` — snapshots canvas pixels
  synchronously (so subsequent draws don't corrupt the queued data), sets
  `nextPending`, starts `drainQueue()` if not already running.
- Queue size 1: the next pending item is always replaced by a newer one;
  in-flight inference always runs to completion (ensures cache is populated).
- After inference: writes to memory cache + IDB, calls `callback(detections)`.

**Export path:** `detectForExport(source, key)` — checks memory cache, then
IDB, then runs inference directly (no queue). Used by `videoEncoder.ts`.

**Cache key:** `{MODEL_NAME}|{filename}|{filesize}|{WxH}|{frameRef}`
where `frameRef` is `img` for images or `t{microseconds}` for video frames.
No mtime — file name + size + dimensions are sufficient for identity.

**Persistent statistics:** inference count and total ms are stored in IDB
(`blurweb4-detections` / `stats` store) and loaded at startup. Used to
show `~Xs per frame` estimates in the status bar.

**Console logging:**
```
[detector] inference key="..." 2340ms detections=2 avg=2190ms
[detector] cache hit (IDB) key="..." detections=2
[detector] export cache hit (memory) key="..." detections=2
```

**Status bar:** `.detect-status` div inside each `.canvas-wrapper`, shown
at top with spinner animation while inference is pending, hidden on completion
or cache hit. Text: `" detecting… (~Xs per frame)"` once stats are available.

**Test reference detections** (from `detect_n_2024_04.onnx` on `jpeg.jpg`
at display size 2704×1521, same scene as first frame of all three videos):
```typescript
{ label: 'plate', conf_min: 0.87, x: 1715, y: 858, w: 67, h: 18 },
{ label: 'plate', conf_min: 0.76, x: 2618, y: 1096, w: 85, h: 62 },
```
Tolerance: ±5 pixels per coordinate. Cross-browser results are identical
(deterministic WASM inference).

## onnxruntime-web WASM files

`build.mjs` copies `ort-*.wasm` and `ort-*.mjs` files from
`node_modules/onnxruntime-web/dist/` into `dist/ort/` at build time.
`detector.ts` sets `ort.env.wasm.wasmPaths = '/dist/ort/'` so the runtime
finds them. The `dist/ort/` directory is gitignored.
