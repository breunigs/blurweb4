# Media Redactor

Browser-based tool for automatically detecting and redacting license plates
and people in images and videos. Runs entirely in-browser — no server, no
uploads.

**Features**
- Drag-and-drop images (JPEG) and videos (H.264, H.265/HEVC, AV1, VP8, VP9)
- YOLOv5 object detection (plates, persons) via ONNX Runtime Web
- Blur, blackout, or outline detected regions
- Video trim and batch export
- GPU-accelerated inference (WebGPU → WebGL → WASM fallback)

## Requirements

- [mise](https://mise.jdx.dev/) — manages the Node.js version
- Node.js 22 (installed automatically by mise)
- Docker — required for the one-time WASM decoder builds

## Development

```sh
mise exec -- npm install
make vendor-hevc    # build HEVC WASM decoder (requires Docker, run once)
make vendor-avc-av1 # build AVC/AV1 WASM decoder (requires Docker, run once)
make dev            # dev server on http://localhost:3000
```

The dev server is esbuild's built-in HTTP server. It watches `src/` and
rebuilds on every change; hard-refresh the browser to pick up changes.

## Production build

```sh
make build   # runs vendor targets automatically, then writes dist/bundle.js
```

Serve the project root with any static file server (e.g. Caddy). No special
headers required; WebCodecs works on `localhost` and any HTTPS origin.

## Testing

```sh
make test   # Playwright tests in Chromium + Firefox
```

To run a single browser or specific test:

```sh
mise exec -- npm test -- --project=chromium
mise exec -- npm test -- --grep "H.264"
```

What the tests verify:

| Test | Method |
|---|---|
| JPEG decoding | Canvas dimensions (2704×1521) + pixel values at 5 coordinates vs. PIL-extracted reference (±20 per channel tolerance) |
| H.264 video | Canvas dimensions (2704×1521) + ≥20 % non-black pixels in first frame |
| AV1 video | Same as H.264 |
| H.265 video | Gracefully skipped — HEVC WebCodecs not available on Linux |

## License

This project is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)**.

## Third-Party Licenses

### npm dependencies

| Package | License | Notes |
|---------|---------|-------|
| [mediabunny](https://mediabunny.dev/) | MPL-2.0 | Video/audio demuxing and encoding |
| [libav.js](https://github.com/Yahweasel/libav.js) | LGPL-2.1+ | FFmpeg compiled to WASM; sources in `node_modules/libav.js/sources/` |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | MIT | ONNX ML inference runtime |
| [stackblur-canvas](https://github.com/flozz/StackBlur) | MIT | Stack blur algorithm |
| [esbuild](https://github.com/evanw/esbuild) | MIT | JavaScript bundler (dev) |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 | TypeScript compiler (dev) |
| [@playwright/test](https://github.com/microsoft/playwright) | Apache-2.0 | Browser test framework (dev) |
| [prettier](https://github.com/prettier/prettier) | MIT | Code formatter (dev) |

### Vendor WASM binaries

The pre-built WASM binaries in `vendor/` embed FFmpeg and codec libraries:

| Binary | Components | License |
|--------|-----------|---------|
| `vendor/libav-hevc/` | FFmpeg 8.0 (HEVC/AAC decoder), libav.js wrapper, musl libc | LGPL-2.1+, 0BSD, MIT/ISC |
| `vendor/libav-avc-av1/` | FFmpeg 8.0 (H.264 decoder), libaom AV1 decoder, libav.js wrapper, musl libc | LGPL-2.1+, BSD-2-Clause, 0BSD, MIT/ISC |

Full details and source locations are in each vendor subdirectory's `LICENSE` file.

**LGPL compliance:** LGPL-2.1 requires source code availability for the binary
recipient. Sources for all LGPL-licensed components (FFmpeg 8.0) are included
in the libav.js npm package at `node_modules/libav.js/sources/`.

### License compatibility

All dependencies are compatible with AGPL-3.0 — no conflicts:

- MIT, BSD, 0BSD, Apache-2.0 — permissive, no copyleft
- LGPL-2.1+ — compatible; allows use in AGPL projects without relicensing the LGPL code
- MPL-2.0 — file-scoped copyleft; compatible with AGPL for aggregation
