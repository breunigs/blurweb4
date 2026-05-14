export interface ImageExportResult {
  blob: Blob;
  filename: string;
}

/** Encodes the canvas as a JPEG and returns the blob + output filename. */
export function exportAsJpeg(
  canvas: HTMLCanvasElement,
  sourceFilename: string,
  quality = 0.92,
): Promise<ImageExportResult> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) { reject(new Error('canvas.toBlob returned null')); return; }
        const stem = sourceFilename.replace(/\.[^.]+$/, '');
        resolve({ blob, filename: stem + '.jpg' });
      },
      'image/jpeg',
      quality,
    );
  });
}
