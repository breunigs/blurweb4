# blurweb4

Static media preview webapp. Drag-and-drop (or file-pick) images and videos;
each file gets its own tab with a canvas preview. Videos are decoded via
[mediabunny](https://mediabunny.dev/) (WebCodecs) with play/pause/seek controls.

## Requirements

- [mise](https://mise.jdx.dev/) — manages the Node.js version
- Node.js 22 (installed automatically by mise)

## Local development

```sh
mise exec -- npm install      # first time only
mise exec -- npm run dev
```

Open <http://localhost:3000>.

The dev server is esbuild's built-in HTTP server. It watches `src/` and
rebuilds on every change; hard-refresh the browser to pick up changes.

## Production build

```sh
mise exec -- npm run build
```

Output: `dist/bundle.js`. Serve the project root with any static file server
(e.g. Caddy). No special headers are required beyond what a normal static
server provides; WebCodecs works on `localhost` and any HTTPS origin.

## Testing

Tests use [Playwright](https://playwright.dev/) and run in real Chromium and
Firefox browsers (downloaded automatically on first run).

```sh
mise exec -- npm test
```

The test command starts the esbuild dev server automatically (port 3000) and
tears it down when done. If a server is already running on that port it is
reused.

What the tests verify:

| Test | Method |
|---|---|
| JPEG decoding | Canvas dimensions (2704×1521) + pixel values at 5 coordinates compared against PIL-extracted reference (±20 per channel tolerance) |
| H.264 video | Canvas dimensions (2704×1521) + ≥20 % non-black pixels in first frame |
| AV1 video | Same as H.264 |
| H.265 video | Gracefully skipped — HEVC is not supported by WebCodecs on Linux |

To run a single browser:

```sh
mise exec -- npm test -- --project=chromium
mise exec -- npm test -- --project=firefox
```

To run a specific test:

```sh
mise exec -- npm test -- --grep "H.264"
```
