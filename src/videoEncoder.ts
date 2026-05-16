import {
  Input, ALL_FORMATS, BlobSource,
  Output, Mp4OutputFormat, WebMOutputFormat,
  BufferTarget, Conversion,
} from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { detectEncoder } from './encoderConfig';
import { detectForExport, makeVideoKey, applyDetections } from './detector';
import { getConfig } from './config';

export interface EncodeResult {
  buffer: ArrayBuffer;
  filename: string;
}

export async function encodeVideo(
  file: File,
  onProgress: (p: number) => void,
  trimStart?: number,
  trimEnd?: number,
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

    let offscreen: OffscreenCanvas | null = null;
    let offCtx: OffscreenCanvasRenderingContext2D | null = null;
    const drawMode = getConfig().drawMode;

    // Build trim option only when values are defined and non-trivial.
    const trim: { start?: number; end?: number } | undefined =
      (trimStart !== undefined && trimStart > 0) || trimEnd !== undefined
        ? { start: trimStart, end: trimEnd }
        : undefined;

    const conversion = await Conversion.init({
      input,
      output,
      ...(trim ? { trim } : {}),
      // Copy normalised tags (title, date, etc.) but strip raw Uint8Array blobs.
      // GoPro writes ~25 KB of proprietary GPMF telemetry as raw ilst atoms; if
      // copied verbatim they produce output that ffprobe rejects as invalid data.
      tags: (input) => {
        const { raw, ...rest } = input;
        const safeRaw: typeof raw = {};
        for (const [k, v] of Object.entries(raw ?? {})) {
          if (typeof v === 'string') safeRaw[k] = v;
        }
        return { ...rest, ...(Object.keys(safeRaw).length ? { raw: safeRaw } : {}) };
      },
      video: {
        codec:                enc.codec,
        hardwareAcceleration: enc.hardwareAcceleration,
        process: async (sample: VideoSample): Promise<OffscreenCanvas> => {
          if (!offscreen || offscreen.width !== sample.displayWidth || offscreen.height !== sample.displayHeight) {
            offscreen = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
            offCtx = offscreen.getContext('2d')!;
          }
          sample.draw(offCtx!, 0, 0);
          // Key uses the absolute container timestamp — same as preview seek.
          // Frames previewed at the trim-start position hit the cache here.
          const key = makeVideoKey(file, offscreen.width, offscreen.height, sample.microsecondTimestamp);
          const detections = await detectForExport(offscreen, key);
          applyDetections(offCtx!, detections, drawMode);
          return offscreen;
        },
      },
    });

    conversion.onProgress = onProgress;
    await conversion.execute();

    const stem = file.name.replace(/\.[^.]+$/, '');
    return { buffer: target.buffer!, filename: stem + enc.ext };
  } finally {
    input.dispose();
  }
}
