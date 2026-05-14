import {
  Input, ALL_FORMATS, BlobSource,
  Output, Mp4OutputFormat, WebMOutputFormat,
  BufferTarget, Conversion,
} from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { detectEncoder } from './encoderConfig';
import { detectForExport, makeVideoKey, drawDetections } from './detector';

export interface EncodeResult {
  buffer: ArrayBuffer;
  filename: string;
}

/**
 * Re-encodes `file` using the best available codec/hardware combination and
 * returns the resulting buffer.
 *
 * Detection boxes are baked into every frame via the Conversion.process hook.
 * Inference results are cached (memory + IDB), so frames already seen during
 * preview are not re-inferred.
 * Audio is automatically passed through (no audio options → mediabunny default).
 *
 * @param onProgress Called with a value in [0, 1] as encoding progresses.
 */
export async function encodeVideo(
  file: File,
  onProgress: (p: number) => void,
): Promise<EncodeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`No video track in "${file.name}"`);

    const width  = await track.getCodedWidth();
    const height = await track.getCodedHeight();

    const enc = await detectEncoder(width, height);
    if (!enc) throw new Error('No encodable video codec available in this browser');

    const format = enc.ext === '.webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });

    // OffscreenCanvas for drawing frames + detections during encoding.
    let offscreen: OffscreenCanvas | null = null;
    let offCtx: OffscreenCanvasRenderingContext2D | null = null;

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec:                enc.codec,
        hardwareAcceleration: enc.hardwareAcceleration,
        process: async (sample: VideoSample): Promise<OffscreenCanvas> => {
          if (!offscreen || offscreen.width !== sample.displayWidth || offscreen.height !== sample.displayHeight) {
            offscreen = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
            offCtx = offscreen.getContext('2d')!;
          }
          sample.draw(offCtx!, 0, 0);
          const key = makeVideoKey(file, offscreen.width, offscreen.height, sample.microsecondTimestamp);
          const detections = await detectForExport(offscreen, key);
          drawDetections(offCtx!, detections);
          return offscreen;
        },
      },
      // No audio options → mediabunny automatically passes audio through.
    });

    conversion.onProgress = onProgress;
    await conversion.execute();

    const stem = file.name.replace(/\.[^.]+$/, '');
    return { buffer: target.buffer!, filename: stem + enc.ext };
  } finally {
    input.dispose();
  }
}
