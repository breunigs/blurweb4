import * as esbuild from 'esbuild';

const dev = process.argv.includes('--dev');

const buildConfig = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'esm',
  sourcemap: dev,
  target: ['chrome114', 'firefox115'],
  minify: !dev,
};

if (dev) {
  const ctx = await esbuild.context(buildConfig);
  await ctx.watch();
  const { host, port } = await ctx.serve({
    servedir: '.',
    port: 3000,
  });
  console.log(`Dev server: http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
} else {
  await esbuild.build(buildConfig);
  console.log('Build complete → dist/bundle.js');
}
