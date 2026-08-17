import { findJpegApp1 } from './jpegUtils';

export interface ImageExportResult {
  blob: Blob;
  filename: string;
}

/** Byte sizes for each TIFF data type (indexed by type code 1–12). */
const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8,   // BYTE ASCII SHORT LONG RATIONAL
  6: 1, 7: 1, 8: 2, 9: 4, 10: 8,  // SBYTE UNDEFINED SSHORT SLONG SRATIONAL
  11: 4, 12: 8,                     // FLOAT DOUBLE
};

/**
 * Build a minimal EXIF APP1 segment (FF E1 + length + "Exif\0\0" + TIFF)
 * containing only the GPS IFD and DateTimeOriginal from the source JPEG's EXIF.
 * Returns null if the source has no EXIF or neither GPS nor DateTimeOriginal.
 */
function extractGpsOnlyExif(jpeg: Uint8Array): Uint8Array | null {
  const exifSegment = findJpegApp1(jpeg);
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
  let exifIfdOff: number | null = null;

  for (let i = 0; i < ifd0Count; i++) {
    const tag = r16(ifd0Off + 2 + i * 12);
    if (tag === 0x8825) gpsIfdOff = r32(ifd0Off + 2 + i * 12 + 8);
    if (tag === 0x8769) exifIfdOff = r32(ifd0Off + 2 + i * 12 + 8);
  }

  type IFDEntry = { tag: number; type: number; count: number; data: Uint8Array };

  function readIfdEntry(base: number): IFDEntry {
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
    }
    return { tag, type, count, data };
  }

  // Collect GPS IFD entries
  let gpsEntries: IFDEntry[] = [];
  let gpsOutlineSize = 0;
  if (gpsIfdOff !== null) {
    const gpsCount = r16(gpsIfdOff);
    for (let i = 0; i < gpsCount; i++) {
      const entry = readIfdEntry(gpsIfdOff + 2 + i * 12);
      if (entry.data.length > 4) gpsOutlineSize += entry.data.length;
      gpsEntries.push(entry);
    }
  }

  // Find DateTimeOriginal (0x9003) in Exif sub-IFD
  let dateTimeEntry: IFDEntry | null = null;
  let dateTimeOutlineSize = 0;
  if (exifIfdOff !== null) {
    const exifCount = r16(exifIfdOff);
    for (let i = 0; i < exifCount; i++) {
      if (r16(exifIfdOff + 2 + i * 12) === 0x9003) {
        dateTimeEntry = readIfdEntry(exifIfdOff + 2 + i * 12);
        if (dateTimeEntry.data.length > 4) dateTimeOutlineSize = dateTimeEntry.data.length;
        break;
      }
    }
  }

  if (gpsEntries.length === 0 && !dateTimeEntry) return null;

  // Layout of new TIFF:
  //   [0..7]       TIFF header (byte order + magic + IFD0 offset → 8)
  //   [8..]        IFD0: count(2) + N entries(N*12) + next(4)
  //   [gpsStart]   GPS IFD (if present): count(2) + n*12 + next(4) + outline data
  //   [exifStart]  Exif sub-IFD (if DateTimeOriginal): count(2) + 1*12 + next(4) + outline data
  const hasGps = gpsEntries.length > 0;
  const hasDateTime = dateTimeEntry !== null;
  const ifd0EntryCount = (hasGps ? 1 : 0) + (hasDateTime ? 1 : 0);
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;

  const gpsStart = 8 + ifd0Size;
  const gpsIfdBodySize = hasGps ? 2 + gpsEntries.length * 12 + 4 : 0;

  const exifStart = gpsStart + gpsIfdBodySize + gpsOutlineSize;
  const exifIfdBodySize = hasDateTime ? 2 + 1 * 12 + 4 : 0;

  const totalSize = exifStart + exifIfdBodySize + dateTimeOutlineSize;
  const newTiff = new Uint8Array(totalSize);

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

  // IFD0 entries (must be in ascending tag order per TIFF spec)
  w16(8, ifd0EntryCount);
  let ifd0Idx = 0;
  if (hasDateTime) {
    const base = 10 + ifd0Idx * 12;
    w16(base, 0x8769);     // ExifIFD tag
    w16(base + 2, 4);      // LONG type
    w32(base + 4, 1);      // count = 1
    w32(base + 8, exifStart);
    ifd0Idx++;
  }
  if (hasGps) {
    const base = 10 + ifd0Idx * 12;
    w16(base, 0x8825);     // GPSInfo tag
    w16(base + 2, 4);      // LONG type
    w32(base + 4, 1);      // count = 1
    w32(base + 8, gpsStart);
    ifd0Idx++;
  }
  w32(10 + ifd0EntryCount * 12, 0); // next IFD = 0

  // GPS IFD entries
  if (hasGps) {
    w16(gpsStart, gpsEntries.length);
    let dataPos = gpsStart + gpsIfdBodySize;
    for (let i = 0; i < gpsEntries.length; i++) {
      const { tag, type, count, data } = gpsEntries[i];
      const base = gpsStart + 2 + i * 12;
      w16(base, tag);
      w16(base + 2, type);
      w32(base + 4, count);
      if (data.length <= 4) {
        newTiff.set(data, base + 8);
      } else {
        w32(base + 8, dataPos);
        newTiff.set(data, dataPos);
        dataPos += data.length;
      }
    }
    w32(gpsStart + 2 + gpsEntries.length * 12, 0); // GPS IFD next = 0
  }

  // Exif sub-IFD with DateTimeOriginal
  if (hasDateTime) {
    w16(exifStart, 1); // 1 entry
    const base = exifStart + 2;
    w16(base, dateTimeEntry!.tag);
    w16(base + 2, dateTimeEntry!.type);
    w32(base + 4, dateTimeEntry!.count);
    if (dateTimeEntry!.data.length <= 4) {
      newTiff.set(dateTimeEntry!.data, base + 8);
    } else {
      const dataPos = exifStart + exifIfdBodySize;
      w32(base + 8, dataPos);
      newTiff.set(dateTimeEntry!.data, dataPos);
    }
    w32(exifStart + 2 + 1 * 12, 0); // Exif IFD next = 0
  }

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
 * Neutralise the EXIF orientation tag (0x0112) in an APP1 segment by setting
 * it to 1 (normal).  The canvas pixels are already rotated by createImageBitmap,
 * so keeping the original value would cause viewers to double-rotate the export.
 *
 * Previous approach removed the 12-byte IFD entry, which shifted all subsequent
 * data without adjusting TIFF offset pointers — corrupting the entire EXIF
 * structure (sub-IFD pointers, out-of-line data offsets).
 */
function stripOrientationTag(app1: Uint8Array): Uint8Array {
  // APP1 layout: FF E1 (2) + length (2) + "Exif\0\0" (6) + TIFF data
  if (app1.length < 18) return app1;
  const tiff = app1.subarray(10);
  const isLE = tiff[0] === 0x49;

  const r16 = (o: number) =>
    isLE ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
  const r32 = (o: number) =>
    isLE
      ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
      : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0;

  if (r16(2) !== 0x002a) return app1;
  const ifd0Off = r32(4);
  if (ifd0Off + 2 > tiff.length) return app1;
  const count = r16(ifd0Off);

  for (let i = 0; i < count; i++) {
    const e = ifd0Off + 2 + i * 12;
    if (r16(e) === 0x0112) {
      // Overwrite orientation value to 1 (normal) in a copy, preserving all
      // byte positions so TIFF offset pointers remain valid.
      const result = new Uint8Array(app1);
      const valueOff = 10 + e + 8; // position in app1 of the 4-byte value field
      if (isLE) {
        result[valueOff] = 1; result[valueOff + 1] = 0;
      } else {
        result[valueOff] = 0; result[valueOff + 1] = 1;
      }
      result[valueOff + 2] = 0; result[valueOff + 3] = 0;
      return result;
    }
  }
  return app1; // no orientation tag present
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
  outputStem?: string,
): Promise<ImageExportResult> {
  const needsSource = keepMetadata !== 'strip' && sourceFile?.type === 'image/jpeg';
  console.log(`[export] metadata=${keepMetadata} file=${sourceFilename} type=${sourceFile?.type ?? 'none'} needsSource=${needsSource}`);
  const [canvasBlob, sourceBytes] = await Promise.all([
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality);
    }),
    needsSource ? sourceFile!.arrayBuffer().then((b) => new Uint8Array(b)) : Promise.resolve(null),
  ]);

  let finalBlob = canvasBlob;
  if (sourceBytes) {
    let exifSegment =
      keepMetadata === 'gps' ? extractGpsOnlyExif(sourceBytes) : findJpegApp1(sourceBytes);
    console.log(`[export] EXIF APP1 ${exifSegment ? `found (${exifSegment.length} bytes)` : 'not found'}`);
    if (exifSegment) {
      exifSegment = stripOrientationTag(exifSegment);
      const canvasBytes = new Uint8Array(await canvasBlob.arrayBuffer());
      const injected = injectExif(canvasBytes, exifSegment);
      finalBlob = new Blob([injected], { type: 'image/jpeg' });
      // Verify: first bytes should be FF D8 FF E1, followed by "Exif\0\0"
      const hdr = Array.from(injected.subarray(0, 12))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`[export] injected EXIF into output (${finalBlob.size} bytes), header: ${hdr}`);
    }
  } else if (keepMetadata !== 'strip') {
    console.log(`[export] no source bytes — metadata not preserved (type=${sourceFile?.type ?? 'no file'})`);
  }

  const stem = outputStem ?? sourceFilename.replace(/\.[^.]+$/, '');
  return { blob: finalBlob, filename: stem + '.jpg' };
}
