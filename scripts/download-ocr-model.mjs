#!/usr/bin/env node
/**
 * Downloads PaddleOCR English recognition ONNX model + character dictionary.
 *
 * Outputs:
 *   models/ocr/rec.onnx   (~7.8 MB)
 *   models/ocr/dict.txt   (436-char English dictionary)
 *
 * Model from monkt/paddleocr-onnx on Hugging Face (Apache 2.0).
 * Checksums are verified after download.
 */

import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'models/ocr';

const ASSETS = [
  {
    name: 'rec.onnx',
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/rec.onnx',
    sha256: '4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7',
  },
  {
    name: 'dict.txt',
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/dict.txt',
    sha256: 'e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6',
  },
];

function sha256(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  let done = false;
  let written = 0;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) {
      ws.write(value);
      written += value.length;
      if (total > 0) {
        const pct = Math.round((written / total) * 100);
        process.stdout.write(`\r  ${dest} ${(written / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`);
      }
    }
  }
  ws.end();
  await new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
  if (total > 0) process.stdout.write('\n');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const asset of ASSETS) {
    const dest = join(OUT_DIR, asset.name);
    if (existsSync(dest)) {
      const actual = sha256(dest);
      if (actual === asset.sha256) {
        console.log(`✓ ${dest} (cached, checksum OK)`);
        continue;
      }
      console.log(`  ${dest} checksum mismatch — re-downloading`);
      unlinkSync(dest);
    }

    console.log(`↓ Downloading ${asset.name}…`);
    await download(asset.url, dest);

    const actual = sha256(dest);
    if (actual !== asset.sha256) {
      unlinkSync(dest);
      throw new Error(`Checksum mismatch for ${dest}: expected ${asset.sha256}, got ${actual}`);
    }
    console.log(`  ✓ checksum OK`);
  }

  console.log('OCR model ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
