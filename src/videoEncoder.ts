import {
  Input,
  ALL_FORMATS,
  BlobSource,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  Conversion,
} from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { detectEncoder } from './encoderConfig';
import { detectForExport, makeVideoKey, filterByConf } from './detector';
import { applyDetections } from './detectionDrawer';
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
  keepMetadata: 'keep' | 'gps' | 'strip' = 'keep',
  keepAudio = true,
  outputStem?: string,
): Promise<EncodeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`No video track in "${file.name}"`);

    const width = await track.getCodedWidth();
    const height = await track.getCodedHeight();

    // Use the source file's average bitrate for the output.
    // getAverageBitrate() reads container metadata and often returns null when
    // the container doesn't embed a bitrate field. Fall back to estimating from
    // file size ÷ duration (subtracting ~192 kbps for audio overhead).
    let sourceBitrate = await track.getAverageBitrate();
    if (sourceBitrate === null) {
      const duration = await input.getDurationFromMetadata([track]);
      if (duration && duration > 0) {
        const AUDIO_OVERHEAD_BPS = 192_000;
        sourceBitrate = Math.max(100_000, Math.round((file.size * 8) / duration) - AUDIO_OVERHEAD_BPS);
        console.log(
          `[videoEncoder] bitrate from file size: ${(sourceBitrate / 1_000_000).toFixed(2)} Mbps (file=${file.size} dur=${duration.toFixed(2)}s)`,
        );
      }
    } else {
      console.log(`[videoEncoder] bitrate from metadata: ${(sourceBitrate / 1_000_000).toFixed(2)} Mbps`);
    }

    const enc = await detectEncoder(width, height);
    if (!enc) throw new Error('No encodable video codec available in this browser');
    console.log(
      `[videoEncoder] encoding ${enc.codec} / ${enc.hardwareAcceleration} bitrate=${sourceBitrate ? `${(sourceBitrate / 1_000_000).toFixed(2)} Mbps` : 'mediabunny-default'}`,
    );

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
      // 'keep': copy normalised tags but strip raw Uint8Array blobs (GoPro GPMF etc.)
      // 'gps':  keep only the ©xyz location string (ISO 6709); strip everything else
      // 'strip': suppress all metadata
      tags: keepMetadata === 'strip'
        ? {}
        : keepMetadata === 'gps'
        ? (input) => {
            // For MP4/QuickTime, mediabunny puts ilst atom data (including ©xyz)
            // into the `raw` field — NOT into the top-level normalized fields.
            // ©xyz — QuickTime/Apple/GoPro GPS coordinate string (ISO 6709 format)
            // loci  — QuickTime location atom (older cameras)
            const GPS_KEYS = new Set(['©xyz', 'loci']);
            const { raw } = input;
            const gpsRaw: typeof raw = {};
            for (const [k, v] of Object.entries(raw ?? {})) {
              if (GPS_KEYS.has(k)) gpsRaw[k] = v;
            }
            return Object.keys(gpsRaw).length ? { raw: gpsRaw } : {};
          }
        : (input) => {
            const { raw, ...rest } = input;
            const safeRaw: typeof raw = {};
            for (const [k, v] of Object.entries(raw ?? {})) {
              if (typeof v === 'string') safeRaw[k] = v;
            }
            return { ...rest, ...(Object.keys(safeRaw).length ? { raw: safeRaw } : {}) };
          },
      ...(keepAudio ? {} : { audio: { discard: true } }),
      video: {
        codec: enc.codec,
        hardwareAcceleration: enc.hardwareAcceleration,
        ...(sourceBitrate !== null ? { bitrate: sourceBitrate } : {}),
        process: async (sample: VideoSample): Promise<OffscreenCanvas> => {
          if (!offscreen || offscreen.width !== sample.displayWidth || offscreen.height !== sample.displayHeight) {
            offscreen = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
            offCtx = offscreen.getContext('2d')!;
          }
          sample.draw(offCtx!, 0, 0);
          // Key uses the absolute container timestamp — same as preview seek.
          // Frames previewed at the trim-start position hit the cache here.
          const key = await makeVideoKey(file, offscreen.width, offscreen.height, sample.microsecondTimestamp);
          const detections = filterByConf(await detectForExport(offscreen, key), getConfig().minConfidence);
          applyDetections(offCtx!, detections, drawMode);
          return offscreen;
        },
      },
    });

    conversion.onProgress = onProgress;
    await conversion.execute();

    const stem = outputStem ?? file.name.replace(/\.[^.]+$/, '');
    return { buffer: target.buffer!, filename: stem + enc.ext };
  } finally {
    input.dispose();
  }
}
