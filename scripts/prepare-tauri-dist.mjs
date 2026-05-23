#!/usr/bin/env node
/**
 * Assembles tauri-dist/ from built sources — mirrors the URL layout that
 * the esbuild dev server and Go binary serve from the project root:
 *
 *   /              → index.html
 *   /src/…         → src/style.css
 *   /dist/…        → dist/bundle.js, dist/hevcWorker.js, dist/ort/…
 *   /models/…      → models/…
 *   /vendor/…      → vendor/libav-hevc/…, vendor/libav-avc-av1/…
 *   /examples/…    → examples/…
 *
 * Tauri's frontendDist points here; the webview serves files from this
 * directory. Run after `node build.mjs` (prod build).
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'tauri-dist');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

function copyFile(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function walkAndCopy(srcDir, destDir, { skipMaps = false } = {}) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (skipMaps && entry.name.endsWith('.map')) continue;
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      walkAndCopy(src, dest, { skipMaps });
    } else {
      copyFile(src, dest);
    }
  }
}

// Root files
for (const name of ['index.html', 'sw.js', 'manifest.json', 'icon.svg', 'robots.txt']) {
  const src = join(ROOT, name);
  if (!existsSync(src)) {
    console.warn(`  ${name} — skipped (not found)`);
    continue;
  }
  copyFile(src, join(OUT, name));
  console.log(`  ${name}`);
}

// src/style.css — referenced directly from index.html as "src/style.css"
copyFile(join(ROOT, 'src', 'style.css'), join(OUT, 'src', 'style.css'));
console.log('  src/style.css');

// dist/ — skip sourcemaps
walkAndCopy(join(ROOT, 'dist'), join(OUT, 'dist'), { skipMaps: true });
console.log('  dist/');

// examples/ — served at /examples/* for the "Load examples" button
walkAndCopy(join(ROOT, 'examples'), join(OUT, 'examples'));
console.log('  examples/');

// models/
walkAndCopy(join(ROOT, 'models'), join(OUT, 'models'));
console.log('  models/');

// vendor/ — include only subdirs that exist (WASM files may not be built yet).
// On macOS Tauri builds (SKIP_HEVC_WASM=1), native WebCodecs handles HEVC so
// the 2 MB libav-hevc WASM is excluded to reduce bundle size.
const skipHevcWasm = process.env.SKIP_HEVC_WASM === '1';
for (const dir of ['libav-hevc', 'libav-avc-av1']) {
  if (dir === 'libav-hevc' && skipHevcWasm) {
    console.log(`  vendor/${dir}/ — skipped (SKIP_HEVC_WASM=1)`);
    continue;
  }
  const src = join(ROOT, 'vendor', dir);
  if (!existsSync(src)) {
    console.warn(`  vendor/${dir}/ — skipped (not built)`);
    continue;
  }
  walkAndCopy(src, join(OUT, 'vendor', dir));
  console.log(`  vendor/${dir}/`);
}

console.log(`\ntauri-dist/ ready`);
