export async function renderImage(
  file: File,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const bitmap = await createImageBitmap(file);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D rendering context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
}
