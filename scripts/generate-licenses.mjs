#!/usr/bin/env node
/**
 * Generates tauri-dist/licenses.html (self-contained) and tauri-dist/licenses.txt
 * by collecting LICENSE files from all npm and Cargo dependencies.
 *
 * Called from scripts/prepare-tauri-dist.mjs during tauri-build.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TAURI_DIST = join(ROOT, 'tauri-dist');
mkdirSync(TAURI_DIST, { recursive: true });

/** Find and read a LICENSE / COPYING file in a directory, or return null. */
function findLicenseText(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return null; }
  const name = entries.find(f => /^(license|copying)(\.txt|\.md|\.rst|\.html)?$/i.test(f));
  if (!name) return null;
  try { return readFileSync(join(dir, name), 'utf8').trim(); } catch { return null; }
}

const parts = [];

function sectionHeader(title) {
  const bar = '═'.repeat(72);
  parts.push(`\n${bar}\n  ${title}\n${bar}\n`);
}

function packageEntry(name, version, spdx, licenseText) {
  const sep = '─'.repeat(72);
  const body = licenseText || `(No license file found; SPDX identifier: ${spdx})`;
  parts.push(`${sep}\n${name}  ${version}\nLicense: ${spdx}\n\n${body}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// npm / JavaScript packages
// ─────────────────────────────────────────────────────────────────────────────
sectionHeader('JavaScript / npm dependencies');

let lock;
try {
  lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
} catch {
  parts.push('(package-lock.json not found)\n');
}

if (lock) {
  const seen = new Set();
  for (const [pkgPath, info] of Object.entries(lock.packages ?? {})) {
    if (!pkgPath.startsWith('node_modules/')) continue;
    const dir = join(ROOT, pkgPath);
    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const name = pkgJson.name ?? pkgPath.slice('node_modules/'.length);
    const version = pkgJson.version ?? info.version ?? '';
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spdx = pkgJson.license ?? info.license ?? 'Unknown';
    packageEntry(name, version, spdx, findLicenseText(dir));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rust / Cargo packages
// ─────────────────────────────────────────────────────────────────────────────
sectionHeader('Rust / Cargo dependencies');

try {
  const manifestPath = join(ROOT, 'src-tauri', 'Cargo.toml');
  const raw = execSync(`cargo metadata --format-version 1 --manifest-path "${manifestPath}"`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const meta = JSON.parse(raw);
  const tauriSrc = join(ROOT, 'src-tauri');
  const seen = new Set();
  for (const pkg of meta.packages) {
    // Skip our own workspace crate
    if (pkg.manifest_path.startsWith(tauriSrc + '/') ||
        pkg.manifest_path.startsWith(tauriSrc + '\\')) continue;
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pkgDir = dirname(pkg.manifest_path);
    packageEntry(pkg.name, pkg.version, pkg.license ?? 'Unknown', findLicenseText(pkgDir));
  }
} catch (e) {
  parts.push(`(Could not retrieve Cargo package licenses: ${e.message})\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Assemble and write
// ─────────────────────────────────────────────────────────────────────────────
const intro =
  'THIRD-PARTY SOFTWARE LICENSES\n' +
  'This product includes open-source software from the following projects.\n';
const text = intro + parts.join('\n');

writeFileSync(join(TAURI_DIST, 'licenses.txt'), text, 'utf8');

// Self-contained HTML — text embedded inline, no external fetch needed.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Licenses</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    background: #f5f5f5;
    color: #111;
    padding: 20px 24px;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
</head>
<body>${escapeHtml(text)}</body>
</html>`;

writeFileSync(join(TAURI_DIST, 'licenses.html'), html, 'utf8');
console.log('  licenses.html + licenses.txt');
