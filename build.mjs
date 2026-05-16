import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';

const dev  = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3000);

// ── HEVC WASM artifacts ───────────────────────────────────────────────────
// Build the libav.js hevc-aac variant on first use if it isn't present.
// The vendor/ directory is gitignored; this runs automatically after clone.
const HEVC_WASM = 'vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.wasm';
if (!existsSync(HEVC_WASM)) {
  console.log('HEVC WASM not found — running build:hevc (requires Docker)…');
  const result = spawnSync(process.execPath, ['scripts/build-hevc.mjs'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('build:hevc failed. Build aborted.');
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

const buildConfig = {
  entryPoints: {
    bundle:     'src/main.ts',
    hevcWorker: 'src/hevcWorker.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  sourcemap: dev,
  target: ['chrome114', 'firefox115'],
  minify: !dev,
};

if (dev) {
  const ctx = await esbuild.context(buildConfig);
  await ctx.watch();
  const { port: actualPort } = await ctx.serve({
    servedir: '.',
    port,
  });
  console.log(`Dev server: http://localhost:${actualPort}`);
  console.log('Press Ctrl+C to stop.');
} else {
  await esbuild.build(buildConfig);
  console.log('Build complete → dist/bundle.js + dist/hevcWorker.js');
}
