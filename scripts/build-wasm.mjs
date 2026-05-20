#!/usr/bin/env node
/**
 * Builds both libav.js WASM variants using Docker + Emscripten in a single run.
 *
 * Neither variant is published to npm (MPEG/patent reasons), so both must be
 * compiled from the source tarballs that ship inside the libav.js npm package.
 * This script automates the full pipeline:
 *
 *   1. Extract libav.js source tree from node_modules/libav.js/sources/
 *   2. Copy library source tarballs into build/ (skips curl downloads)
 *   3. Build a Docker image with Emscripten (emscripten/emsdk)
 *   4. Generate the avc-av1 variant config via configs/mkconfig.js
 *   5. Run `make` for both targets in parallel inside one container
 *   6. Copy outputs to vendor/libav-hevc/ and vendor/libav-avc-av1/
 *
 * Outputs:
 *   vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs    (~260 KB)
 *   vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.wasm   (~2.2 MB)
 *   vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs  (~300 KB)
 *   vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.wasm (~3 MB)
 *
 * Requirements: Docker (running), ~3 GB free disk space, internet for the
 * first pull of emscripten/emsdk.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT          = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd();
const SOURCES       = join(ROOT, 'node_modules', 'libav.js', 'sources');
const VENDOR_HEVC   = join(ROOT, 'vendor', 'libav-hevc');
const VENDOR_AVC    = join(ROOT, 'vendor', 'libav-avc-av1');
const HEVC_MJS      = join(VENDOR_HEVC, 'libav-6.8.8.0-hevc-aac.wasm.mjs');
const HEVC_WASM     = join(VENDOR_HEVC, 'libav-6.8.8.0-hevc-aac.wasm.wasm');
const AVC_MJS       = join(VENDOR_AVC,  'libav-6.8.8.0-avc-av1.wasm.mjs');
const AVC_WASM      = join(VENDOR_AVC,  'libav-6.8.8.0-avc-av1.wasm.wasm');

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
if (existsSync(HEVC_MJS) && existsSync(HEVC_WASM) && existsSync(AVC_MJS) && existsSync(AVC_WASM)) {
  console.log('All WASM artifacts already present — nothing to do.');
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
  console.error('Start Docker and re-run: npm run build:wasm');
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
  run('docker', [
    'build',
    '-f', join(tmpDir, 'Dockerfile.development'),
    '-t', 'blurweb4-libavjs-builder',
    tmpDir,
  ]);

  // 4. Generate the avc-av1 config (hevc-aac is pre-generated in the source tree)
  console.log('[4/5] Generating avc-av1 config…');
  run('docker', [
    'run', '--rm',
    '-v', `${tmpDir}:/work`,
    '-w', '/work',
    'blurweb4-libavjs-builder',
    'bash', '-c',
    `cd configs && node mkconfig.js avc-av1 '${AVC_AV1_COMPONENTS}'`,
  ]);

  // 5. Compile both variants in parallel inside one container.
  //    FFmpeg source is extracted+patched once; libaom is built once.
  //    The two per-variant ffmpeg compiles run concurrently via make -j.
  console.log('[5/5] Compiling hevc-aac + avc-av1 variants in parallel (10–25 min)…');
  run('docker', [
    'run', '--rm',
    '-v', `${tmpDir}:/work`,
    '-w', '/work',
    'blurweb4-libavjs-builder',
    'bash', '-c',
    'MAKEFLAGS=-j$(nproc) make dist/libav-6.8.8.0-hevc-aac.wasm.mjs dist/libav-6.8.8.0-avc-av1.wasm.mjs',
  ]);

  // ── Copy outputs ─────────────────────────────────────────────────────────
  mkdirSync(VENDOR_HEVC, { recursive: true });
  mkdirSync(VENDOR_AVC,  { recursive: true });
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-hevc-aac.wasm.mjs'),  HEVC_MJS]);
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-hevc-aac.wasm.wasm'), HEVC_WASM]);
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-avc-av1.wasm.mjs'),   AVC_MJS]);
  run('cp', [join(tmpDir, 'dist', 'libav-6.8.8.0-avc-av1.wasm.wasm'),  AVC_WASM]);

  console.log('\nDone. Artifacts written to vendor/libav-hevc/ and vendor/libav-avc-av1/');
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
