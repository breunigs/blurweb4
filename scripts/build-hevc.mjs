#!/usr/bin/env node
/**
 * Builds the libav.js hevc-aac WASM variant using Docker + Emscripten.
 *
 * The hevc-aac variant is not published to npm (MPEG patent reasons), so it
 * must be compiled from the source tarballs that ship inside the libav.js npm
 * package.  This script automates the full pipeline:
 *
 *   1. Extract libav.js source tree from node_modules/libav.js/sources/
 *   2. Build a Docker image with Emscripten (emscripten/emsdk)
 *   3. Run `make build-hevc-aac` inside the container
 *   4. Copy the two output files to vendor/libav-hevc/
 *
 * Outputs:
 *   vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs   (~260 KB)
 *   vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.wasm  (~2.2 MB)
 *
 * Requirements: Docker (running), ~2 GB free disk space, internet for the
 * first pull of emscripten/emsdk.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT       = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd();
const VENDOR_DIR = join(ROOT, 'vendor', 'libav-hevc');
const SOURCES    = join(ROOT, 'node_modules', 'libav.js', 'sources');
const OUT_MJS    = join(VENDOR_DIR, 'libav-6.8.8.0-hevc-aac.wasm.mjs');
const OUT_WASM   = join(VENDOR_DIR, 'libav-6.8.8.0-hevc-aac.wasm.wasm');

// ── Already built? ────────────────────────────────────────────────────────
if (existsSync(OUT_MJS) && existsSync(OUT_WASM)) {
  console.log('hevc-aac artifacts already present — nothing to do.');
  process.exit(0);
}

// ── Preflight checks ──────────────────────────────────────────────────────
if (!existsSync(SOURCES)) {
  console.error('Error: libav.js npm package not found. Run `npm install` first.');
  process.exit(1);
}

const dockerCheck = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dockerCheck.status !== 0) {
  console.error('Error: Docker is not running or not installed.');
  console.error('Start Docker and re-run: npm run build:hevc');
  process.exit(1);
}

// ── Set up temporary build directory ─────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'blurweb4-libavjs-'));
console.log(`Build directory: ${tmpDir}`);

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

try {
  // 1. Extract libav.js source tree (Makefile, configs/, src/, patches/, …)
  console.log('\n[1/4] Extracting libav.js source…');
  run('tar', ['xf', join(SOURCES, 'libav.js.tar.xz'), '-C', tmpDir]);

  // 2. Copy all library source tarballs into the same directory so the
  //    Makefile can find them (ffmpeg, opus, libvpx, …)
  console.log('[2/4] Copying library sources…');
  for (const file of readdirSync(SOURCES)) {
    if (file === 'libav.js.tar.xz') continue;
    run('cp', [join(SOURCES, file), join(tmpDir, file)]);
  }

  // 3. Build Docker image (uses emscripten/emsdk as base)
  console.log('[3/4] Building Docker image (emscripten/emsdk — first run pulls ~1 GB)…');
  run('docker', [
    'build',
    '-f', join(tmpDir, 'Dockerfile.development'),
    '-t', 'blurweb4-libavjs-builder',
    tmpDir,
  ]);

  // 4. Compile the hevc-aac variant inside the container
  console.log('[4/4] Compiling hevc-aac variant (5–15 min depending on machine)…');
  run('docker', [
    'run', '--rm',
    '-v', `${tmpDir}:/work`,
    '-w', '/work',
    'blurweb4-libavjs-builder',
    'make', 'build-hevc-aac',
  ]);

  // ── Copy outputs ────────────────────────────────────────────────────────
  mkdirSync(VENDOR_DIR, { recursive: true });
  run('cp', [
    join(tmpDir, 'dist', 'libav-6.8.8.0-hevc-aac.wasm.mjs'),
    OUT_MJS,
  ]);
  run('cp', [
    join(tmpDir, 'dist', 'libav-6.8.8.0-hevc-aac.wasm.wasm'),
    OUT_WASM,
  ]);

  console.log(`\nDone. Artifacts written to vendor/libav-hevc/`);
} finally {
  // Docker wrote files as root inside tmpDir, so plain rmSync fails with EACCES.
  // Run a throwaway Alpine container to delete them first.
  spawnSync('docker', [
    'run', '--rm',
    '-v', `${tmpDir}:/work`,
    'alpine',
    'sh', '-c', 'rm -rf /work/*',
  ], { stdio: 'ignore' });
  rmSync(tmpDir, { recursive: true, force: true });
}
