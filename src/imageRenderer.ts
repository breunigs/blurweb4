import { isLowMemoryDevice } from './config';

// Limit concurrent createImageBitmap calls to avoid exhausting Firefox's GPU
// compositor resources when many large images are opened simultaneously.
//
// Each call in flight holds a fully decoded bitmap — ~48 MB for a 12 MP phone
// photo — on top of the canvas it is about to be drawn into. Four at once is
// nearly 200 MB of transient bitmaps, more than a whole tab's budget on an
// older iPhone, so constrained devices decode one at a time. Only the active
// image is displayed anyway, so the lost pipelining costs little.
const MAX_CONCURRENT = isLowMemoryDevice() ? 1 : 4;
let active = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function release(): void {
  const next = waitQueue.shift();
  if (next) { next(); } else { active--; }
}

export async function renderImage(file: File, canvas: HTMLCanvasElement): Promise<void> {
  await acquire();
  try {
    // imageOrientation: 'from-image' ensures EXIF rotation tags are honoured
    // consistently across browsers (Chrome defaults to this; Firefox did not before v93).
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get 2D rendering context');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } finally {
    release();
  }
}
