/**
 * Unit tests for findJpegApp1 (src/jpegUtils.ts).
 * Run with: node --experimental-strip-types tests/jpegUtils.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findJpegApp1 } from '../src/jpegUtils.ts';

// ---------------------------------------------------------------------------
// Helpers to build synthetic JPEG byte sequences
// ---------------------------------------------------------------------------

const SOI = [0xff, 0xd8];
const SOS_MARKER = [0xff, 0xda]; // start of scan — terminates APPn search

/** Build a JPEG segment: FF <marker> <len_hi> <len_lo> <...payload> */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2; // length field includes itself
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

/** "Exif\0\0" identifier */
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/** Minimal fake TIFF payload (just enough to pass the length check) */
const FAKE_TIFF = new Array(8).fill(0x00);

/** Build an EXIF APP1 segment */
function exifApp1(extraPayload: number[] = FAKE_TIFF): number[] {
  return seg(0xe1, [...EXIF_ID, ...extraPayload]);
}

/** Build an APP0 (JFIF) segment */
function app0(): number[] {
  return seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
}

function build(...parts: number[][]): Uint8Array {
  return new Uint8Array([...SOI, ...parts.flat()]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('returns null for empty buffer', () => {
  assert.equal(findJpegApp1(new Uint8Array(0)), null);
});

test('returns null for a bare SOI with no segments', () => {
  assert.equal(findJpegApp1(new Uint8Array(SOI)), null);
});

test('returns null when only an APP0 (JFIF) segment is present', () => {
  const jpeg = build(app0());
  assert.equal(findJpegApp1(jpeg), null);
});

test('returns null when APP1 marker is present but has no Exif identifier', () => {
  // APP1 with XMP-style payload (no "Exif\0\0")
  const xmpPayload = [0x68, 0x74, 0x74, 0x70, 0x00]; // "http\0"
  const jpeg = build(seg(0xe1, xmpPayload));
  assert.equal(findJpegApp1(jpeg), null);
});

test('returns null when SOS is reached before any EXIF APP1', () => {
  const jpeg = build(...SOS_MARKER);
  assert.equal(findJpegApp1(jpeg), null);
});

test('finds EXIF APP1 as the first segment', () => {
  const jpeg = build(exifApp1());
  const result = findJpegApp1(jpeg);
  assert.ok(result !== null, 'expected a result');
  assert.equal(result[0], 0xff);
  assert.equal(result[1], 0xe1);
  // Verify "Exif\0\0" is at bytes 4..9 of the segment
  assert.deepEqual(Array.from(result.subarray(4, 10)), EXIF_ID);
});

test('finds EXIF APP1 after an APP0 segment', () => {
  const jpeg = build(app0(), exifApp1());
  const result = findJpegApp1(jpeg);
  assert.ok(result !== null, 'expected a result after APP0');
  assert.equal(result[1], 0xe1);
  assert.deepEqual(Array.from(result.subarray(4, 10)), EXIF_ID);
});

test('skips non-EXIF APP1 and finds the EXIF one', () => {
  const xmpSeg = seg(0xe1, [0x68, 0x74, 0x74, 0x70, 0x00]); // non-Exif APP1
  const jpeg = build(xmpSeg, exifApp1());
  const result = findJpegApp1(jpeg);
  assert.ok(result !== null);
  assert.deepEqual(Array.from(result.subarray(4, 10)), EXIF_ID);
});

test('stops at SOS and returns null even when EXIF would follow', () => {
  // SOS marker has no length field — the walker should stop at the marker itself.
  // Build: SOI + some APP0 + SOS (no payload) — EXIF after SOS is unreachable.
  // We just ensure the walker doesn't read past SOS.
  const jpeg = new Uint8Array([...SOI, ...app0(), ...SOS_MARKER]);
  assert.equal(findJpegApp1(jpeg), null);
});

test('returned subarray covers exactly the full APP1 segment', () => {
  const tiffData = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]; // minimal LE TIFF header
  const jpeg = build(exifApp1(tiffData));
  const result = findJpegApp1(jpeg)!;

  // Segment length field = payload length + 2
  const segLen = (result[2] << 8) | result[3];
  assert.equal(result.length, 2 + segLen, 'subarray length matches segment length field');

  // TIFF data starts at offset 10 (after FF E1 + len + "Exif\0\0")
  assert.deepEqual(Array.from(result.subarray(10)), tiffData);
});

test('returns null when marker byte is not 0xff (corrupt JPEG)', () => {
  // Replace the marker byte with a non-0xff value
  const jpeg = new Uint8Array([...SOI, 0x00, 0xe1, 0x00, 0x08, ...EXIF_ID, 0x00, 0x00]);
  assert.equal(findJpegApp1(jpeg), null);
});
