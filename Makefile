GO := $(shell mise which go)
.PHONY: dev build test vendor-wasm go-build go-run prepare-go-embed tauri-dev tauri-build deploy

node_modules/.package-lock.json: package-lock.json
	npm install
	@touch $@

## Start the development server (hot-reload on port 3000)
dev: node_modules/.package-lock.json
	node build.mjs --dev

## Production build → dist/bundle.js (requires vendor-wasm first)
build: node_modules/.package-lock.json vendor-wasm
	node build.mjs

## Run unit tests + Playwright tests (Chromium + Firefox, port 3100)
test: build
	node --experimental-strip-types --test tests/unit/*.test.ts
	npx playwright test

## Build both libav.js WASM variants in parallel → vendor/libav-hevc/ + vendor/libav-avc-av1/
vendor-wasm:
	node scripts/build-wasm.mjs

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

## Start the Tauri development window (hot-reload via esbuild dev server on port 3000)
tauri-dev: node_modules/.package-lock.json
	npx tauri dev

## Build Tauri release bundles → src-tauri/target/release/bundle/
tauri-build: node_modules/.package-lock.json
	npm run build
	npm run prepare-tauri-dist
	npx tauri icon icon.svg
	npx tauri build

## Deploy dist to remote server: set BLURWEB_RSYNC_TARGET=user@host:/path/to/webroot
## server/dist-embedded/ contains both plain and .gz variants; nginx gzip_static can
## serve pre-compressed files automatically when configured with `gzip_static on`.
deploy: prepare-go-embed
	@test -n "$(BLURWEB_RSYNC_TARGET)" || (echo "Error: BLURWEB_RSYNC_TARGET is not set"; exit 1)
	rsync -r --progress --partial server/dist-embedded/ $(BLURWEB_RSYNC_TARGET)
