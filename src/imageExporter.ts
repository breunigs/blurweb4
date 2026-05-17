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

/**
 * Return a new JPEG buffer with all APPn segments from the canvas-produced
 * JPEG replaced by the given EXIF APP1 segment.
 */
function injectExif(canvasJpeg: Uint8Array, exifSegment: Uint8Array): Uint8Array {
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
  keepMetadata = true,
  quality = 0.92,
): Promise<ImageExportResult> {
  const [canvasBlob, sourceBytes] = await Promise.all([
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality);
    }),
    keepMetadata && sourceFile?.type === 'image/jpeg'
      ? sourceFile.arrayBuffer().then((b) => new Uint8Array(b))
      : Promise.resolve(null),
  ]);

  let finalBlob = canvasBlob;
  if (sourceBytes) {
    const exif = extractExif(sourceBytes);
    if (exif) {
      const canvasBytes = new Uint8Array(await canvasBlob.arrayBuffer());
      finalBlob = new Blob([injectExif(canvasBytes, exif)], { type: 'image/jpeg' });
    }
  }

  const stem = sourceFilename.replace(/\.[^.]+$/, '');
  return { blob: finalBlob, filename: stem + '.jpg' };
}
