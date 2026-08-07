import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3000);

// ── libav.js WASM artifacts ───────────────────────────────────────────────
// Build both libav.js WASM variants on first use if either is missing.
// The vendor/ directory is gitignored; this runs automatically after clone.
const HEVC_WASM = 'vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.wasm';
const AVC_WASM  = 'vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.wasm';
if (!existsSync(HEVC_WASM) || !existsSync(AVC_WASM)) {
  console.log('WASM artifacts missing — running build:wasm (requires Docker)…');
  const result = spawnSync(process.execPath, ['scripts/build-wasm.mjs'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('build:wasm failed. Build aborted.');
    process.exit(result.status ?? 1);
  }
}

// ── onnxruntime-web WASM artifacts ───────────────────────────────────────────
// Copy ort WASM files into dist/ort/ so the browser can fetch them.
function copyOrtWasm() {
  const src = 'node_modules/onnxruntime-web/dist';
  const dst = 'dist/ort';
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    // Copy WASM binaries and their JS/MJS loader wrappers (needed for dynamic imports at runtime).
    if (f.endsWith('.wasm') || (f.startsWith('ort-') && f.endsWith('.mjs'))) {
      copyFileSync(`${src}/${f}`, `${dst}/${f}`);
    }
  }
}
copyOrtWasm();

// ── Content hashing ──────────────────────────────────────────────────────────
// Each resource URL gets ?v=<md5> of the referenced file so browsers fetch a
// new version exactly when the file content changes.

function fileHash(...paths) {
  const h = createHash('md5');
  for (const p of paths) h.update(readFileSync(p));
  return h.digest('hex').slice(0, 8);
}

// Worker hash placeholders — unique strings that survive minification and are
// replaced in dist/bundle.js after we compute real worker output hashes.
const PH = {
  DETECTOR_WORKER: '__PH_DETW__',
  HEVC_WORKER:     '__PH_HVCW__',
  BLUR_WORKER:     '__PH_BLRW__',
  OCR_WORKER:      '__PH_OCRW__',
};

// In dev mode, a startup timestamp stands in for all hashes (esbuild serves
// from memory so content hashing isn't meaningful).
const devTs = dev ? String(Date.now()) : '';

// Static file hashes — computed before the esbuild build.
const staticH = dev ? {} : {
  MODEL_N:    fileHash('models/detect_n_2024_04.onnx'),
  MODEL_X:    fileHash(...Array.from({ length: 9 }, (_, i) => `models/detect_x_2024_04.onnx.${i}`)),
  OCR_REC:    fileHash('models/ocr/rec.onnx'),
  OCR_DET:    fileHash('models/ocr/det.onnx'),
  OCR_DICT:   fileHash('models/ocr/dict.txt'),
  LIBAV_HEVC: existsSync('vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs')
    ? fileHash('vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs', HEVC_WASM) : '0',
  LIBAV_AVC:  existsSync('vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs')
    ? fileHash('vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs', AVC_WASM) : '0',
  STYLE:      fileHash('src/style.css'),
};

function h(key) { return dev ? devTs : staticH[key]; }

// On macOS Tauri builds, native WebCodecs handles HEVC — skip the 2 MB WASM fallback.
const skipHevcWasm = process.env.SKIP_HEVC_WASM === '1';

const buildConfig = {
  entryPoints: {
    bundle: 'src/main.ts',
    hevcWorker: 'src/hevcWorker.ts',
    detectorWorker: 'src/detector.worker.ts',
    blurWorker: 'src/blurWorker.ts',
    ocrWorker: 'src/ocr.worker.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  sourcemap: dev,
  target: ['chrome114', 'firefox115'],
  minify: !dev,
  define: {
    'SKIP_HEVC_WASM':       String(skipHevcWasm),
    // Static file hashes (content md5 in prod, timestamp in dev)
    'HASH_MODEL_N':         JSON.stringify(h('MODEL_N')),
    'HASH_MODEL_X':         JSON.stringify(h('MODEL_X')),
    'HASH_OCR_REC':         JSON.stringify(h('OCR_REC')),
    'HASH_OCR_DET':         JSON.stringify(h('OCR_DET')),
    'HASH_OCR_DICT':        JSON.stringify(h('OCR_DICT')),
    'HASH_LIBAV_HEVC':      JSON.stringify(h('LIBAV_HEVC')),
    'HASH_LIBAV_AVC':       JSON.stringify(h('LIBAV_AVC')),
    // Worker hashes — placeholders in prod (replaced after build with real md5s),
    // timestamp in dev.
    'HASH_DETECTOR_WORKER': JSON.stringify(dev ? devTs : PH.DETECTOR_WORKER),
    'HASH_HEVC_WORKER':     JSON.stringify(dev ? devTs : PH.HEVC_WORKER),
    'HASH_BLUR_WORKER':     JSON.stringify(dev ? devTs : PH.BLUR_WORKER),
    'HASH_OCR_WORKER':      JSON.stringify(dev ? devTs : PH.OCR_WORKER),
  },
};

// ── Service worker ────────────────────────────────────────────────────────────
// Generate sw.js with a baked-in cache version so each build invalidates the
// previous cache. The SW is served from / so it controls the whole origin.
// Cache name is derived from content hashes — it only changes when outputs change.

function generateServiceWorker(workerH) {
  const wh = workerH;
  const cacheId = dev
    ? devTs
    : createHash('md5')
        .update(Object.values({ ...staticH, ...wh }).join(','))
        .digest('hex').slice(0, 10);

  const sw = `// Auto-generated by build.mjs — do not edit.
const CACHE = 'blurweb-${cacheId}';

// Precache the core app shell so the UI loads offline.
const PRECACHE = ['/', '/src/style.css', '/dist/bundle.js', '/dist/hevcWorker.js?v=${wh.HEVC_WORKER}', '/dist/detectorWorker.js?v=${wh.DETECTOR_WORKER}', '/dist/blurWorker.js?v=${wh.BLUR_WORKER}', '/dist/ocrWorker.js?v=${wh.OCR_WORKER}'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(PRECACHE.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => c.put(url, res))
      ))
    )
  );
  self.skipWaiting();
});

// Remove old caches from previous versions.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for same-origin GET requests (models, WASM, assets).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});
`;
  writeFileSync('sw.js', sw);
}

// Compute real worker hashes: do a preliminary build, hash the output files,
// then inject those hashes back into the config for the final build/serve.
async function computeWorkerHashes() {
  await esbuild.build(buildConfig);
  const workerH = {
    DETECTOR_WORKER: fileHash('dist/detectorWorker.js'),
    HEVC_WORKER:     fileHash('dist/hevcWorker.js'),
    BLUR_WORKER:     fileHash('dist/blurWorker.js'),
    OCR_WORKER:      fileHash('dist/ocrWorker.js'),
  };
  // Patch defines with real hashes for the final build
  for (const [key, hash] of Object.entries(workerH)) {
    buildConfig.define[`HASH_${key}`] = JSON.stringify(hash);
  }
  return workerH;
}

if (dev) {
  const devWorkerH = { DETECTOR_WORKER: devTs, HEVC_WORKER: devTs, BLUR_WORKER: devTs, OCR_WORKER: devTs };
  generateServiceWorker(devWorkerH);
  const ctx = await esbuild.context(buildConfig);
  await ctx.watch();
  const { port: actualPort } = await ctx.serve({
    servedir: '.',
    port,
  });
  console.log(`Dev server: http://localhost:${actualPort}`);
  console.log('Press Ctrl+C to stop.');
} else {
  // Two-pass build: first pass gets worker hashes, second bakes them into bundle.
  const workerH = await computeWorkerHashes();
  await esbuild.build(buildConfig);

  // Replace any remaining placeholders in bundle.js (shouldn't be any after the
  // second build, but belt-and-suspenders).
  let bundle = readFileSync('dist/bundle.js', 'utf8');
  for (const [key, placeholder] of Object.entries(PH)) {
    bundle = bundle.replaceAll(placeholder, workerH[key]);
  }
  writeFileSync('dist/bundle.js', bundle);

  generateServiceWorker(workerH);

  console.log('Build complete → dist/bundle.js + dist/hevcWorker.js + dist/detectorWorker.js + dist/blurWorker.js + dist/ocrWorker.js');
}
