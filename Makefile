GO := $(shell mise which go)
.PHONY: dev build test vendor-hevc vendor-avc-av1 go-build go-run prepare-go-embed

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

## Run the server directly via go run (no binary written)
go-run: prepare-go-embed
	cd server && $(GO) run .

## Cross-compile standalone server binaries → release/  (requires Go via mise)
go-build: prepare-go-embed
	mkdir -p release
	cd server && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags '-s -w' -o ../release/blurweb-windows-amd64.exe .
	cd server && GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags '-s -w' -o ../release/blurweb-linux-amd64 .
	cd server && GOOS=linux   GOARCH=arm   CGO_ENABLED=0 GOARM=7 $(GO) build -ldflags '-s -w' -o ../release/blurweb-linux-arm .
	cd server && GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags '-s -w' -o ../release/blurweb-darwin-amd64 .
	cd server && GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 $(GO) build -ldflags '-s -w' -o ../release/blurweb-darwin-arm64 .

## Populate server/dist-embedded/ with gzip-compressed assets (runs build first)
prepare-go-embed: build
	node scripts/prepare-go-embed.mjs
