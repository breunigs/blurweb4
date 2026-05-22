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
import { detectForExport, makeVideoKey, applyFilters } from './detector';
import { applyDetections } from './detectionDrawer';
import { getConfig } from './config';

export interface EncodeResult {
  buffer: ArrayBuffer;
  filename: string;
}

interface EncodeFinalizationStats {
  count: number;
  totalFinalizationMs: number;
  totalEncodingMs: number;
}

function loadFinalizationStats(): EncodeFinalizationStats {
  try {
    const raw = localStorage.getItem('blurweb4-encode-stats');
    if (raw) return JSON.parse(raw) as EncodeFinalizationStats;
  } catch { /* ignore */ }
  return { count: 0, totalFinalizationMs: 0, totalEncodingMs: 0 };
}

function saveFinalizationStats(s: EncodeFinalizationStats): void {
  try { localStorage.setItem('blurweb4-encode-stats', JSON.stringify(s)); } catch { /* ignore */ }
}

export async function encodeVideo(
  file: File,
  onProgress: (p: number) => void,
  trimStart?: number,
  trimEnd?: number,
  keepMetadata: 'keep' | 'gps' | 'strip' = 'keep',
  keepAudio = true,
  outputStem?: string,
  isCancelled?: () => boolean,
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
    const solidColor = getConfig().solidColor;

    // Build trim option only when values are defined and non-trivial.
    const trim: { start?: number; end?: number } | undefined =
      (trimStart !== undefined && trimStart > 0) || trimEnd !== undefined
        ? { start: trimStart, end: trimEnd }
        : undefined;

    const finStats = loadFinalizationStats();
    // Fraction of total time spent in finalization phase (default 10% when no data yet).
    const finalizationFraction = finStats.count > 0
      ? finStats.totalFinalizationMs / (finStats.totalEncodingMs + finStats.totalFinalizationMs)
      : 0.10;

    const encodeStart = performance.now();
    let finalizationStartTime: number | null = null;
    let finalizationTimer: ReturnType<typeof setInterval> | null = null;
    let capturedEstimatedMs = 0;

    // Remap mediabunny's 0→1 progress to 0→(1−r) during encoding, then drive
    // a timer-based interpolation from (1−r)→1 during container finalization.
    const wrappedProgress = (p: number): void => {
      if (p >= 1.0) {
        if (finalizationStartTime === null) {
          finalizationStartTime = performance.now();
          const encodingMs = finalizationStartTime - encodeStart;
          // Use stored average if available; otherwise 10% of encoding time.
          capturedEstimatedMs = finStats.count > 0
            ? finStats.totalFinalizationMs / finStats.count
            : encodingMs * 0.10;

          finalizationTimer = setInterval(() => {
            const elapsed = performance.now() - finalizationStartTime!;
            // frac approaches 0.99 asymptotically so the timer never falsely reports done.
            const frac = Math.min(elapsed / capturedEstimatedMs, 0.99);
            onProgress((1 - finalizationFraction) + frac * finalizationFraction);
          }, 100);
        }
        return; // suppress mediabunny's 1.0; batchExporter calls onFileProgress(i,1) after execute()
      }
      // Leave room at the top of the progress range for the finalization phase.
      onProgress(p * (1 - finalizationFraction));
    };

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
          if (isCancelled?.()) throw new DOMException('Export cancelled', 'AbortError');
          if (!offscreen || offscreen.width !== sample.displayWidth || offscreen.height !== sample.displayHeight) {
            offscreen = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
            offCtx = offscreen.getContext('2d')!;
          }
          sample.draw(offCtx!, 0, 0);
          // mediabunny re-zeros sample.microsecondTimestamp relative to the trim
          // start before invoking process() — add trimStart back to recover the
          // absolute container timestamp so the cache key matches the preview path.
          const tsAbsolute = sample.microsecondTimestamp + (trimStart ?? 0) * 1_000_000;
          const key = await makeVideoKey(file, offscreen.width, offscreen.height, tsAbsolute);
          const detections = applyFilters(await detectForExport(offscreen, key), getConfig().minConfidence, getConfig().enabledLabels);
          if (isCancelled?.()) throw new DOMException('Export cancelled', 'AbortError');
          await applyDetections(offCtx!, detections, drawMode, solidColor, getConfig().expansionFraction);
          // Expose for integration tests — populate only when the test has armed the collector.
          const _g = window as unknown as Record<string, unknown>;
          if (Array.isArray(_g.__exportedFrameDetections)) {
            (_g.__exportedFrameDetections as unknown[]).push(detections);
          }
          return offscreen;
        },
      },
    });

    conversion.onProgress = wrappedProgress;
    try {
      await conversion.execute();
    } finally {
      if (finalizationTimer !== null) {
        clearInterval(finalizationTimer);
        finalizationTimer = null;
      }
    }

    if (finalizationStartTime !== null) {
      const actualFinalizationMs = performance.now() - finalizationStartTime;
      const encodingMs = finalizationStartTime - encodeStart;
      saveFinalizationStats({
        count: finStats.count + 1,
        totalFinalizationMs: finStats.totalFinalizationMs + actualFinalizationMs,
        totalEncodingMs: finStats.totalEncodingMs + encodingMs,
      });
      console.log(
        `[videoEncoder] finalization: ${actualFinalizationMs.toFixed(0)}ms` +
        ` (estimated ${capturedEstimatedMs.toFixed(0)}ms, fraction=${(finalizationFraction * 100).toFixed(1)}%)`,
      );
    }

    const stem = outputStem ?? file.name.replace(/\.[^.]+$/, '');
    return { buffer: target.buffer!, filename: stem + enc.ext };
  } finally {
    input.dispose();
  }
}
