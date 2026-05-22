/**
 * Web Worker — runs StackBlur off the main thread.
 *
 * Protocol:
 *  Main → Worker  { id: number, pixels: ArrayBuffer (transferred), width, height, strength }
 *  Worker → Main  { id: number, blurred: ArrayBuffer (transferred) }
 *                  — or —
 *                 { id: number, error: string }
 */

import { imageDataRGB } from 'stackblur-canvas';

self.addEventListener('message', (e: MessageEvent) => {
  const { id, pixels, width, height, strength } = e.data as {
    id: number;
    pixels: ArrayBuffer;
    width: number;
    height: number;
    strength: number;
  };
  try {
    const data = new Uint8ClampedArray(pixels);
    const imgData = new ImageData(data, width, height);
    imageDataRGB(imgData, 0, 0, width, height, strength);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { id, blurred: imgData.data.buffer },
      [imgData.data.buffer],
    );
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String(err) });
  }
});
