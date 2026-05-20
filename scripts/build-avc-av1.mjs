#!/usr/bin/env node
/**
 * Builds the libav.js avc-av1 WASM variant using Docker + Emscripten.
 *
 * The avc-av1 variant is not published to npm (patent/licensing reasons), so
 * it must be compiled from the source tarballs that ship inside the libav.js
 * npm package.  This script automates the full pipeline:
 *
 *   1. Extract libav.js source tree from node_modules/libav.js/sources/
 *   2. Build a Docker image with Emscripten (emscripten/emsdk)
 *   3. Generate the variant config via configs/mkconfig.js
 *   4. Run `make dist/libav-6.8.8.0-avc-av1.wasm.mjs` inside the container
 *   5. Copy the two output files to vendor/libav-avc-av1/
 *
 * Outputs:
 *   vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs   (~300 KB)
 *   vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.wasm  (~3 MB)
 *
 * Requirements: Docker (running), ~2 GB free disk space, internet for the
 * first pull of emscripten/emsdk.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd();
const VENDOR_DIR = join(ROOT, 'vendor', 'libav-avc-av1');
const SOURCES = join(ROOT, 'node_modules', 'libav.js', 'sources');
const OUT_MJS = join(VENDOR_DIR, 'libav-6.8.8.0-avc-av1.wasm.mjs');
const OUT_WASM = join(VENDOR_DIR, 'libav-6.8.8.0-avc-av1.wasm.wasm');

const AVC_AV1_COMPONENTS = JSON.stringify([
  'avcodec', // enables ff_init_decoder, ff_decode_multi, ff_free_decoder, av_packet_alloc, av_frame_alloc
  'format-mp4',
  'parser-h264',
  'decoder-h264',
  'parser-av1',
  'decoder-libaom_av1',
  'swscale',
]);

// ── Already built? ────────────────────────────────────────────────────────
if (existsSync(OUT_MJS) && existsSync(OUT_WASM)) {
  console.log('avc-av1 artifacts already present — nothing to do.');
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
  console.error('Start Docker and re-run: npm run build:avc-av1');
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
  console.log('\n[1/5] Extracting libav.js source…');
  run('tar', ['xf', join(SOURCES, 'libav.js.tar.xz'), '-C', tmpDir]);

  // 2. Copy all library source tarballs into build/ so the Makefile finds them
  //    and skips its curl downloads. The Makefile writes downloads to build/<file>;
  //    if that file already exists, make skips the download rule entirely.
  console.log('[2/5] Copying library sources…');
  const buildDir = join(tmpDir, 'build');
  mkdirSync(buildDir, { recursive: true });
  for (const file of readdirSync(SOURCES)) {
    if (file === 'libav.js.tar.xz') continue;
    run('cp', [join(SOURCES, file), join(buildDir, file)]);
  }

  // 3. Build Docker image (uses emscripten/emsdk as base)
  console.log('[3/5] Building Docker image (emscripten/emsdk — first run pulls ~1 GB)…');
  run('docker', ['build', '-f', join(tmpDir, 'Dockerfile.development'), '-t', 'blurweb4-libavjs-builder', tmpDir]);

  // 4. Generate variant config + compile inside the container
  console.log('[4/5] Generating avc-av1 config…');
  run('docker', [
    'run',
    '--rm',
    '-v',
    `${tmpDir}:/work`,
    '-w',
    '/work',
    'blurweb4-libavjs-builder',
    'bash',
    '-c',
    `cd configs && node mkconfig.js avc-av1 '${AVC_AV1_COMPONENTS}'`,
  ]);

  console.log('[5/5] Compiling avc-av1 variant (5–15 min depending on machine)…');
  run('docker', [
    'run',
    '--rm',
    '-v',
    `${tmpDir}:/work`,
    '-w',
    '/work',
    'blurweb4-libavjs-builder',
    'bash',
    '-c',
    `MAKEFLAGS=-j$(nproc) make dist/libav-6.8.8.0-avc-av1.wasm.mjs`,
  ]);

  // ── Copy outputs ────────────────────────────────────────────────────────
  mkdirSync(VENDOR_DIR, { recursive: true });
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-avc-av1.wasm.mjs'), OUT_MJS]);
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-avc-av1.wasm.wasm'), OUT_WASM]);

  console.log(`\nDone. Artifacts written to vendor/libav-avc-av1/`);
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
