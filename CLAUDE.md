# CLAUDE.md — project notes for AI assistants

## Project layout

```
blurweb4/
├── build.mjs             esbuild dev server + production build script
├── index.html            app shell (file list, 3-step UI, canvas, video controls)
├── src/
│   ├── main.ts           entry point — registers decoders, instantiates App
│   ├── app.ts            top-level orchestrator; owns model-loading + inference UI state
│   ├── fileManager.ts    file/video loading, list UI, metadata extraction, inference triggering
│   ├── playbackController.ts  video scrubbing, trim point UI, trim persistence
│   ├── exportManager.ts  batch export orchestration, progress, ETA, wake-lock
│   ├── config.ts         centralized AppConfig with localStorage persistence
│   ├── naming.ts         template-variable substitution for export filenames
│   ├── i18n.ts           EN + DE translations; auto-detect from browser language
│   ├── themeManager.ts   platform (macOS/Windows) + color (light/dark) theme management
│   ├── blurrer.ts        blur / solid-color / pixelate redaction rendering on canvas
│   ├── detectionDrawer.ts  apply detections as outlines or redaction effects
│   ├── fileMeta.ts       EXIF metadata from JPEGs; mediabunny metadata from videos
│   ├── jpegUtils.ts      locate EXIF APP1 segment in JPEG byte stream
│   ├── trimStorage.ts    IndexedDB persistence for video trim points
│   ├── hangDetector.ts   main-thread hang detection via Web Worker rAF heartbeat
│   ├── debugLog.ts       in-memory ring buffer capturing all console output
│   ├── lruMap.ts         fixed-capacity LRU Map used by blurrer mask cache + detector
│   ├── imageRenderer.ts  createImageBitmap → canvas (renders bitmap only, no detection)
│   ├── videoPlayer.ts    mediabunny VideoSampleSink wrapper with play/pause/seek
│   ├── hevcDecoder.ts    libav.js WASM fallback decoder for HEVC (registered at startup)
│   ├── hevcWorker.ts     Web Worker running libav.js HEVC decode (sequential protocol)
│   ├── softwareDecoder.ts  smart WebCodecs decoder with hw→sw→no-pref→libav fallback chain
│   ├── libavCore.ts        shared libav.js AVC/AV1 core (used by softwareDecoder + libavVideoDecoder)
│   ├── libavVideoDecoder.ts  libav.js fallback for AVC/AV1 when WebCodecs entirely absent
│   ├── detector.ts       ONNX cache management, inference scheduling, model loading
│   ├── detector.worker.ts  Web Worker running ONNX inference (offloaded from main thread)
│   ├── encoderConfig.ts  codec/hardware detection for export
│   ├── qualityEncoder.ts WebCodecs AV1 quality-mode encoder (startup probe, SW preferred)
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
closed), loop through ALL remaining WebCodecs modes via `reinitWithNextMode()`,
replaying buffered packets through each.  If all WebCodecs modes are exhausted,
activate the libav inline fallback (see below).  `pendingPackets` is cleared only
on a successful flush.

**libav.js inline fallback (src/libavCore.ts + src/softwareDecoder.ts):**
When all three WebCodecs modes fail at runtime, `SmartWebCodecsDecoder.flush()`
activates a `LibavAvcAv1Core` instance inline — replaying all buffered packets through
libav without any mediabunny decoder re-selection.  This handles browsers like iOS
Safari that report `isConfigSupported = true` but fail at decode time.

The shared logic lives in `src/libavCore.ts` (`LibavAvcAv1Core`, `wasmAvailable`,
`LIBAV_AVC_AV1_CODECS`).  Both `softwareDecoder.ts` and `libavVideoDecoder.ts` import
from it.

**libav.js standalone fallback (src/libavVideoDecoder.ts):**
`LibavVideoFallbackDecoder` activates only when `typeof VideoDecoder === 'undefined'`
(WebCodecs entirely absent).  It's a thin wrapper around `LibavAvcAv1Core`.

**Registration order in main.ts matters:**
1. `hevcDecoder` — HEVC → always libav
2. `softwareDecoder` — AVC/VP9/AV1/VP8 → smart WebCodecs + inline libav fallback
3. `libavVideoDecoder` — AVC/AV1 → libav only when WebCodecs is entirely absent

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

**Color space in emitFrames:**
libav.js returns `frame.color_primaries`, `frame.color_trc`, `frame.color_space`, and
`frame.color_range` using stable FFmpeg enum values. These are mapped to WebCodecs
`VideoColorSpaceInit` and passed to the `VideoSample` constructor. Without this,
Chromium assumes BT.601 limited-range for unknown frames, causing x265 content encoded
with BT.709 to appear overly bright or washed out compared to Firefox (which defaults
to BT.709). The maps live in `hevcDecoder.ts` as `AV_COL_PRI`, `AV_COL_TRC`,
`AV_COL_SPC`; `AV_COL_RANGE_FULL = 2` (JPEG/PC range).

**Building both libav.js variants:**
Neither variant is published to npm (MPEG/patent reasons). Build both from the
source tarball inside the npm package. Both targets run in parallel inside one
Docker container — ffmpeg source is extracted and patched once, libaom is built
once, and the two ffmpeg compiles run concurrently:
```sh
mkdir /tmp/libavjs && tar xf node_modules/libav.js/sources/libav.js.tar.xz -C /tmp/libavjs
cp node_modules/libav.js/sources/*.tar.* /tmp/libavjs/
docker build -f /tmp/libavjs/Dockerfile.development -t libavjs-builder /tmp/libavjs
# Generate the avc-av1 config (hevc-aac config is pre-generated in the source):
docker run --rm -v /tmp/libavjs:/work -w /work libavjs-builder bash -c \
  "cd configs && node mkconfig.js avc-av1 '[\"format-mp4\",\"parser-h264\",\"decoder-h264\",\"parser-av1\",\"decoder-libaom_av1\",\"swscale\"]'"
# Build both variants in parallel:
docker run --rm -v /tmp/libavjs:/work -w /work libavjs-builder bash -c \
  "MAKEFLAGS=-j\$(nproc) make \
    dist/libav-6.8.8.0-hevc-aac.wasm.mjs \
    dist/libav-6.8.8.0-avc-av1.wasm.mjs"
# Copy outputs:
cp /tmp/libavjs/dist/libav-6.8.8.0-hevc-aac.wasm.{mjs,wasm} vendor/libav-hevc/
cp /tmp/libavjs/dist/libav-6.8.8.0-avc-av1.wasm.{mjs,wasm} vendor/libav-avc-av1/
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

## App architecture (src/app.ts + decomposed modules)

`app.ts` was split into focused modules. `App` retains model-loading progress UI,
inference status UI, config sync, and the debug panel. The three new modules are:

- **`fileManager.ts` (`FileManager`)** — file list UI, lazy metadata extraction,
  video/image loading, inference triggering. Callbacks into `App` for UI updates.
- **`playbackController.ts` (`PlaybackController`)** — video scrubbing, trim-point
  UI, trim persistence via `trimStorage`. Parses `[h:]m:ss[.SSS]` input format.
- **`exportManager.ts` (`ExportManager`)** — export button state, per-file + global
  progress, ETA from inference stats, cancellation, wake-lock for mobile.

Test globals (`window.__setDrawMode`, `__setTrimStart`, `__setTrimEnd`, etc.) are
wired up in `App` for Playwright test access without UI interaction.

## Configuration (src/config.ts)

`AppConfig` (via `getConfig()` / `setConfig()`) centralises all user-facing settings
with `localStorage` persistence:

| Key | Values | Notes |
|---|---|---|
| `model` | `detect_n` / `detect_x` | detect_x (178 MB) not persisted until first successful inference |
| `drawMode` | `outline` / `blur` / `solidcolor` / `pixelate` | |
| `metadataMode` | `keep` / `gps-only` / `strip` | |
| `minConfidence` | 0–1 | |
| `expansion` | fraction | uniform box padding |
| `labels` | `plate` / `person` / both | |
| `namingPattern` | template string | see naming.ts |

## Export filename naming (src/naming.ts)

`applyPattern(pattern, vars)` substitutes `{variable}` tokens. Supported variables:
`input`, `index`, `year`, `month`, `day`, `hour`, `minute`, `timezone`,
`lat`, `lon`, `duration`, `model`, `redaction_style`, `detect`, `min_confidence`,
`area_expansion`. Unknown or unavailable variables become empty strings.

## Redaction rendering (src/blurrer.ts + src/detectionDrawer.ts)

**`Blurrer` (singleton `blurrer`)** renders three redaction styles onto a canvas context:
- `blur` — stackblur-canvas with feathered mask (LRU cache of 64 mask bitmaps)
- `solidcolor` — plain fill with rounded corners
- `pixelate` — low-resolution block scaling

Edge clamping: boxes within 0.5% of the canvas border snap flush and lose rounded
corners. Rounded-corner radii are label-specific (`plate`: 0.95×, `person`: 0.80× of
`min(w,h)/2`). Two-pass mask: feathered outer shape + solid interior pin for blur.

**`detectionDrawer.ts`** provides `expandDetections()` (uniform box padding) and
`applyDetections()` (dispatches to `Blurrer` or draws colored outline rectangles).
Works with both `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D`.

## YOLOv5 object detection (src/detector.ts + src/detector.worker.ts)

Model: `models/detect_n_2024_04.onnx` (8 MB) or `detect_x` (178 MB), labels: `plate`, `person`.
Input: `[1, 3, 1280, 1280]` float32 RGB CHW tensor normalized to [0, 1].
Output: `[1, N, 7]` — rows of `[cx, cy, w, h, obj_conf, plate_conf, person_conf]`
in model-pixel coordinates (0..1280, 0..1280).

**ONNX runs in a Web Worker (`detector.worker.ts`)** to avoid main-thread freezes.
The worker protocol is sequential (one message at a time):
- `init` / `changeModel` — load ONNX session, return execution provider
- `infer` — receive `Uint8ClampedArray` pixels (transferred), return detections

**Execution provider priority in the worker:** WebGPU → WASM (WebGL removed; probed
at worker startup, falls back on failure).

**Preprocessing — letterboxing (important):**
The model was trained on letterboxed inputs. `captureSnapshot` on the main thread
scales the source uniformly (`scale = min(MODEL_W/srcW, MODEL_H/srcH)`), draws it
centred, and fills the remaining area with `rgb(114,114,114)` (YOLOv5 default). The
resulting `scale`, `padX`, `padY` are stored in `Snapshot` and used in `postprocess`
to unmap model-pixel coordinates back to original-image coordinates:
```typescript
x = (cx - w/2 - padX) / scale
y = (cy - h/2 - padY) / scale
```
Stretching (old behaviour) caused badly missed detections on portrait sources.

`captureSnapshot` reuses a module-level `OffscreenCanvas(1280, 1280)` singleton
(`_snapshotCanvas` / `_snapshotCtx`) instead of allocating a new one per call.
Safe because `captureSnapshot` runs serially inside the `onnxChain` promise and
pixels are extracted immediately via `getImageData` before the canvas is reused.

**Tensor buffer pre-allocation:**
`buildTensor` in `detector.worker.ts` reuses a module-level `Float32Array(3 * 1280 * 1280)`
(`_tensorBuf`, ~15.7 MB) instead of allocating on every inference. Safe because the
worker handles one inference at a time (sequential protocol).

**Background inference queue (preview path):**
- `scheduleInference(source, key, callback)` — yields the main thread before
  `captureSnapshot` (allows slider/pointer events), then snapshots pixels and sends
  to worker. Size-1 pending queue: newer requests replace older ones; in-flight
  inference always runs to completion.
- After inference: writes to memory LRU cache (500 entries) + IDB, calls `callback`.

**Export path:** `detectForExport(source, key)` — checks memory cache, then IDB,
then runs inference via worker. Used by `videoEncoder.ts`.

**Cache key:** `{MODEL_NAME}|{hash8}|{filename}|{filesize}|{WxH}|{frameRef}`
where `frameRef` is `img` for images or `t{microseconds}` for video frames,
and `hash8` is the first 8 hex bytes of a SHA-256 over the file's first 8 KB
(cached in a `WeakMap<File>` after the first call).

**Persistent statistics:** per-model inference count and total ms are stored in IDB
(`blurweb4-detections` / `stats` store) and loaded at startup. Used to show
`~Xs per frame` estimates in the status bar.

**Console logging:**
```
[detector] inference key="..." 2340ms detections=2 avg=2190ms
[detector] cache hit (IDB) key="..." detections=2
[detector] export cache hit (memory) key="..." detections=2
```

**Status bar:** `.detect-status` div inside each `.canvas-wrapper`, shown at top
with spinner while inference is pending, hidden on completion or cache hit.

**Test reference detections** (from `detect_n_2024_04.onnx` on `jpeg.jpg`
at display size 1429×497, Hamburg street scene with GPS EXIF):
With `THRESHOLD_CONF=0.01` the model returns 2 plates + 16 persons (18 total).
See `JPEG_REF_DETECTIONS` in `media.test.ts` for the full list.
Note: `jpeg.jpg` is a different scene from the three test videos — video first-frame
detection tests have separate reference values in `media.test.ts`.

Video detection tests use **subset matching**: each reference box must appear in the
actual results, but extra browser-specific boxes are tolerated. This handles NMS
differences between Chromium and Firefox (different codec implementations produce
slightly different pixel values, shifting marginal-confidence boxes across the
threshold). Two codec-specific reference sets are used:
- `H264_VIDEO_REF_DETECTIONS` — excludes the `x≈435` box (scores ~0.508 on Firefox,
  below the 0.52 threshold)
- `AV1_H265_VIDEO_REF_DETECTIONS` — excludes the `x≈199` box (Firefox AV1 scores
  ~0.485; libav H.265 doesn't detect it at all)

Tolerance: ±5 pixels per coordinate. ONNX/WASM inference itself is deterministic;
variance comes from decoder pixel differences, not ONNX.

**Debug flag:** Set `window.__detectDebug = true` in the browser console before
opening a file (with cold IDB cache) to log preprocessing params, per-channel
tensor stats (BGR/RGB check), pre-NMS candidates, and coordinate unmap details.

## Hang detection (src/hangDetector.ts)

Inline Web Worker measures rAF lag against a 200 ms threshold. Logs hangs to
`console.warn` (captured by `debugLog`). Resets baseline on window blur/focus
to avoid false positives from battery throttling on mobile/background tabs.
No exports — just side-effects on module load from `main.ts`.

## Theme management (src/themeManager.ts)

`applyTheme()` / `initThemeControls()` — platform (`macOS` / `Windows` / `web`) and
color (`light` / `dark`) selection with `localStorage` persistence. Auto-detects from
UA and `prefers-color-scheme`. Applies `data-theme="platform-color"` on `<html>`.
Migrates legacy `'web'` platform value automatically.

## Internationalisation (src/i18n.ts)

Two languages: English (default) and German. Browser language auto-detected on first
load. `t(key)` looks up a string; `tpl(key, vars)` substitutes `{variable}` tokens.
`applyTranslations()` rewrites all `data-i18n` / `data-i18n-label` DOM attributes.
Language switch calls `setLang()` + page reload (stateless; no hydration needed).

## File metadata (src/fileMeta.ts + src/jpegUtils.ts)

`extractImageMeta(file)` — raw EXIF TIFF parsing via `jpegUtils.findJpegApp1()`:
extracts date/time, timezone offset, GPS latitude/longitude (ISO 6709 decimal).
Only the first 64 KB of the file is read (`file.slice(0, 65536)`); the JPEG spec
places the EXIF APP1 marker near the start of the file, so this covers all
practical cases while avoiding loading large image data into memory.

`extractVideoMeta(file)` — mediabunny `Input` for codec-agnostic metadata + duration.

`FileMeta` fields are used by `naming.ts` for template substitution and shown in the
file list UI.

## Trim persistence (src/trimStorage.ts)

`saveTrim(file, start, end)` / `loadTrim(file)` — IndexedDB persistence keyed by
`${filename}|${filesize}`. Shares the `blurweb4-detections` database (separate
`trims` store). Restores trim points when the same file is re-opened.

## Debug log (src/debugLog.ts)

Patches `console.log/warn/error` at module load into a 1000-entry circular buffer.
`getEntries()` / `copyToClipboard()` exposed to the debug panel UI. Logs browser
environment (UA, screen, WebGPU, WebCodecs) at startup.

## Quality-mode AV1 encoder (src/qualityEncoder.ts)

`QualityModeAv1Encoder` extends mediabunny's `CustomVideoEncoder` to use
`latencyMode: 'quality'` instead of `'realtime'` for better export quality.
A 2×2 startup probe verifies quality mode actually encodes before registering.
Prefers software encoding (more reliable for quality mode). Falls back to
mediabunny's default path if the probe fails.

## onnxruntime-web WASM files

`build.mjs` copies `ort-*.wasm` and `ort-*.mjs` files from
`node_modules/onnxruntime-web/dist/` into `dist/ort/` at build time.
`detector.worker.ts` sets `ort.env.wasm.wasmPaths = '/dist/ort/'` so the runtime
finds them. The `dist/ort/` directory is gitignored.
