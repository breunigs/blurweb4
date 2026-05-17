export interface ImageExportResult {
  blob: Blob;
  filename: string;
}

/**
 * Extract the raw EXIF APP1 segment (marker + length bytes + payload) from a
 * JPEG byte array.  Returns null when no EXIF APP1 is present.
 */
function extractExif(jpeg: Uint8Array): Uint8Array | null {
  let pos = 2; // skip SOI (FF D8)
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1];
    if (marker === 0xda) break; // SOS — no more APPn segments ahead
    const segLen = (jpeg[pos + 2] << 8) | jpeg[pos + 3]; // includes the 2 length bytes
    if (marker === 0xe1) {
      // APP1
      // Check for "Exif\0\0" identifier
      if (
        pos + 10 <= jpeg.length &&
        jpeg[pos + 4] === 0x45 &&
        jpeg[pos + 5] === 0x78 &&
        jpeg[pos + 6] === 0x69 &&
        jpeg[pos + 7] === 0x66 &&
        jpeg[pos + 8] === 0x00 &&
        jpeg[pos + 9] === 0x00
      ) {
        return jpeg.subarray(pos, pos + 2 + segLen);
      }
    }
    pos += 2 + segLen;
  }
  return null;
}

/** Byte sizes for each TIFF data type (indexed by type code 1–12). */
const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8,   // BYTE ASCII SHORT LONG RATIONAL
  6: 1, 7: 1, 8: 2, 9: 4, 10: 8,  // SBYTE UNDEFINED SSHORT SLONG SRATIONAL
  11: 4, 12: 8,                     // FLOAT DOUBLE
};

/**
 * Build a minimal EXIF APP1 segment (FF E1 + length + "Exif\0\0" + TIFF)
 * containing only the GPS IFD from the source JPEG's EXIF.
 * Returns null if the source has no EXIF or no GPS IFD.
 */
function extractGpsOnlyExif(jpeg: Uint8Array): Uint8Array | null {
  const exifSegment = extractExif(jpeg);
  if (!exifSegment) return null;

  // TIFF data starts after: FF E1 (2) + length (2) + "Exif\0\0" (6) = offset 10
  const tiff = exifSegment.subarray(10);
  if (tiff.length < 8) return null;

  const byteOrder = (tiff[0] << 8) | tiff[1];
  const isLE = byteOrder === 0x4949; // "II" = little-endian, "MM" = big-endian

  const r16 = (off: number) =>
    isLE ? tiff[off] | (tiff[off + 1] << 8) : (tiff[off] << 8) | tiff[off + 1];
  const r32 = (off: number) =>
    isLE
      ? (tiff[off] | (tiff[off + 1] << 8) | (tiff[off + 2] << 16) | (tiff[off + 3] << 24)) >>> 0
      : ((tiff[off] << 24) | (tiff[off + 1] << 16) | (tiff[off + 2] << 8) | tiff[off + 3]) >>> 0;

  if (r16(2) !== 0x002a) return null; // TIFF magic check

  const ifd0Off = r32(4);
  const ifd0Count = r16(ifd0Off);
  let gpsIfdOff: number | null = null;

  for (let i = 0; i < ifd0Count; i++) {
    if (r16(ifd0Off + 2 + i * 12) === 0x8825) {
      gpsIfdOff = r32(ifd0Off + 2 + i * 12 + 8);
      break;
    }
  }
  if (gpsIfdOff === null) return null;

  // Collect GPS IFD entries, separating inline vs. out-of-line data
  const gpsCount = r16(gpsIfdOff);
  const entries: Array<{ tag: number; type: number; count: number; data: Uint8Array }> = [];
  let outlineSize = 0;

  for (let i = 0; i < gpsCount; i++) {
    const base = gpsIfdOff + 2 + i * 12;
    const tag = r16(base);
    const type = r16(base + 2);
    const count = r32(base + 4);
    const typeSize = TIFF_TYPE_SIZES[type] ?? 1;
    const totalSize = typeSize * count;
    let data: Uint8Array;
    if (totalSize <= 4) {
      data = tiff.slice(base + 8, base + 8 + totalSize);
    } else {
      const off = r32(base + 8);
      data = tiff.slice(off, off + totalSize);
      outlineSize += totalSize;
    }
    entries.push({ tag, type, count, data });
  }

  // Layout of new TIFF:
  //   [0..7]   TIFF header (byte order + magic + IFD0 offset → 8)
  //   [8..25]  IFD0: count(2) + 1 entry(12) + next(4)
  //   [26..]   GPS IFD: count(2) + n*entry(12) + next(4) + out-of-line data
  const GPS_IFD_OFF = 26;
  const gpsIfdBodySize = 2 + gpsCount * 12 + 4;
  const newTiff = new Uint8Array(GPS_IFD_OFF + gpsIfdBodySize + outlineSize);

  const w16 = (off: number, val: number) => {
    if (isLE) { newTiff[off] = val & 0xff; newTiff[off + 1] = (val >> 8) & 0xff; }
    else       { newTiff[off] = (val >> 8) & 0xff; newTiff[off + 1] = val & 0xff; }
  };
  const w32 = (off: number, val: number) => {
    if (isLE) {
      newTiff[off] = val & 0xff; newTiff[off + 1] = (val >> 8) & 0xff;
      newTiff[off + 2] = (val >> 16) & 0xff; newTiff[off + 3] = (val >>> 24) & 0xff;
    } else {
      newTiff[off] = (val >>> 24) & 0xff; newTiff[off + 1] = (val >> 16) & 0xff;
      newTiff[off + 2] = (val >> 8) & 0xff; newTiff[off + 3] = val & 0xff;
    }
  };

  // TIFF header
  newTiff[0] = newTiff[1] = isLE ? 0x49 : 0x4d;
  w16(2, 0x002a);
  w32(4, 8); // IFD0 at offset 8

  // IFD0: single entry pointing to GPS IFD
  w16(8, 1);           // entry count
  w16(10, 0x8825);     // GPSInfo tag
  w16(12, 4);          // LONG type
  w32(14, 1);          // count = 1
  w32(18, GPS_IFD_OFF); // value = GPS IFD offset
  w32(22, 0);          // next IFD = 0

  // GPS IFD entries
  w16(GPS_IFD_OFF, gpsCount);
  let dataPos = GPS_IFD_OFF + gpsIfdBodySize;

  for (let i = 0; i < entries.length; i++) {
    const { tag, type, count, data } = entries[i];
    const base = GPS_IFD_OFF + 2 + i * 12;
    w16(base, tag);
    w16(base + 2, type);
    w32(base + 4, count);
    if (data.length <= 4) {
      newTiff.set(data, base + 8); // inline, left-aligned, rest stays 0
    } else {
      w32(base + 8, dataPos);
      newTiff.set(data, dataPos);
      dataPos += data.length;
    }
  }
  w32(GPS_IFD_OFF + 2 + gpsCount * 12, 0); // GPS IFD next = 0

  // Wrap in APP1 segment: FF E1 + 2-byte length + "Exif\0\0" + TIFF
  const payload = new Uint8Array(6 + newTiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  payload.set(newTiff, 6);
  const segLen = 2 + payload.length; // length field includes itself
  const result = new Uint8Array(4 + payload.length); // FF E1 + length(2) + payload
  result[0] = 0xff; result[1] = 0xe1;
  result[2] = (segLen >> 8) & 0xff; result[3] = segLen & 0xff;
  result.set(payload, 4);
  return result;
}

/**
 * Return a new JPEG buffer with all APPn segments from the canvas-produced
 * JPEG replaced by the given EXIF APP1 segment.
 */
function injectExif(canvasJpeg: Uint8Array, exifSegment: Uint8Array): Uint8Array<ArrayBuffer> {
  // Skip over all existing APP0..APP15 segments (markers E0..EF).
  let pos = 2; // skip SOI
  while (pos + 4 <= canvasJpeg.length) {
    if (canvasJpeg[pos] !== 0xff) break;
    const marker = canvasJpeg[pos + 1];
    if (marker >= 0xe0 && marker <= 0xef) {
      const segLen = (canvasJpeg[pos + 2] << 8) | canvasJpeg[pos + 3];
      pos += 2 + segLen;
    } else {
      break;
    }
  }
  // Output: SOI + exifSegment + remainder (everything after the old APPn block)
  const result = new Uint8Array(2 + exifSegment.length + (canvasJpeg.length - pos));
  result.set(canvasJpeg.subarray(0, 2)); // SOI
  result.set(exifSegment, 2); // original EXIF APP1
  result.set(canvasJpeg.subarray(pos), 2 + exifSegment.length);
  return result;
}

/** Encodes the canvas as a JPEG and returns the blob + output filename. */
export async function exportAsJpeg(
  canvas: HTMLCanvasElement,
  sourceFilename: string,
  sourceFile?: File,
  keepMetadata: 'keep' | 'gps' | 'strip' = 'keep',
  quality = 0.92,
): Promise<ImageExportResult> {
  const needsSource = keepMetadata !== 'strip' && sourceFile?.type === 'image/jpeg';
  const [canvasBlob, sourceBytes] = await Promise.all([
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality);
    }),
    needsSource ? sourceFile!.arrayBuffer().then((b) => new Uint8Array(b)) : Promise.resolve(null),
  ]);

  let finalBlob = canvasBlob;
  if (sourceBytes) {
    const exifSegment =
      keepMetadata === 'gps' ? extractGpsOnlyExif(sourceBytes) : extractExif(sourceBytes);
    if (exifSegment) {
      const canvasBytes = new Uint8Array(await canvasBlob.arrayBuffer());
      finalBlob = new Blob([injectExif(canvasBytes, exifSegment)], { type: 'image/jpeg' });
    }
  }

  const stem = sourceFilename.replace(/\.[^.]+$/, '');
  return { blob: finalBlob, filename: stem + '.jpg' };
}
