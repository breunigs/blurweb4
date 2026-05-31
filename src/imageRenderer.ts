export async function renderImage(file: File, canvas: HTMLCanvasElement): Promise<void> {
  // imageOrientation: 'from-image' ensures EXIF rotation tags are honoured
  // consistently across browsers (Chrome defaults to this; Firefox did not before v93).
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D rendering context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
}
