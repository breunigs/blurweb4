#!/usr/bin/env node
/**
 * Populates server/dist-embedded/ with gzip-compressed copies of all files
 * the Go binary needs to serve. Run after `node build.mjs` (prod build).
 *
 * URL structure mirrored from the esbuild dev server:
 *   /              → index.html
 *   /dist/…        → dist/bundle.js, dist/hevcWorker.js, dist/ort/…
 *   /models/…      → models/…
 *   /vendor/…      → vendor/libav-hevc/…, vendor/libav-avc-av1/…
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'server', 'dist-embedded');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

function copyGzipped(srcFile, destFile) {
  mkdirSync(dirname(destFile), { recursive: true });
  const data = readFileSync(srcFile);
  writeFileSync(destFile, gzipSync(data, { level: 9 }));
}

function walkAndCopy(srcDir, destDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      walkAndCopy(src, dest);
    } else {
      copyGzipped(src, dest);
    }
  }
}

// dist/ → dist-embedded/dist/  (bundle.js, hevcWorker.js, ort/)
// Skip sourcemaps — not needed in production binary.
function copyDist(srcDir, destDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.endsWith('.map')) continue;
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDist(src, dest);
    } else {
      copyGzipped(src, dest);
    }
  }
}

// index.html
copyGzipped(join(ROOT, 'index.html'), join(OUT, 'index.html'));
console.log('  index.html');

// src/style.css — referenced directly from index.html as "src/style.css"
copyGzipped(join(ROOT, 'src', 'style.css'), join(OUT, 'src', 'style.css'));
console.log('  src/style.css');

// dist/
copyDist(join(ROOT, 'dist'), join(OUT, 'dist'));
console.log('  dist/');

// models/
walkAndCopy(join(ROOT, 'models'), join(OUT, 'models'));
console.log('  models/');

// vendor/ — include only subdirs that exist (WASM files may not be built yet)
for (const dir of ['libav-hevc', 'libav-avc-av1']) {
  const src = join(ROOT, 'vendor', dir);
  if (!existsSync(src)) {
    console.warn(`  vendor/${dir}/ — skipped (not built)`);
    continue;
  }
  walkAndCopy(src, join(OUT, 'vendor', dir));
  console.log(`  vendor/${dir}/`);
}

console.log(`\nserver/dist-embedded/ ready (${countFiles(OUT)} files)`);

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  }
  return n;
}
