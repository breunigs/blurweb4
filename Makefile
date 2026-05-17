.PHONY: dev build test vendor-hevc vendor-avc-av1

## Start the development server (hot-reload on port 3000)
dev:
	node build.mjs --dev

## Production build → dist/bundle.js (requires vendor-hevc + vendor-avc-av1 first)
build: vendor-hevc vendor-avc-av1
	node build.mjs

## Run Playwright tests (Chromium + Firefox, port 3100)
test: build
	npx playwright test

## Build the libav.js HEVC/AAC WASM variant → vendor/libav-hevc/
vendor-hevc:
	node scripts/build-hevc.mjs

## Build the libav.js AVC/AV1 WASM variant → vendor/libav-avc-av1/
vendor-avc-av1:
	node scripts/build-avc-av1.mjs
