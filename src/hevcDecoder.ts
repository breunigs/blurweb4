/**
 * HEVC / H.265 fallback decoder using libav.js (WebAssembly FFmpeg).
 *
 * Always intercepts HEVC — mediabunny custom decoders take priority over
 * WebCodecs, so we cannot rely on WebCodecs as the first try. The reason:
 *
 *   VideoDecoder.isConfigSupported() can return {supported: true} on Linux
 *   Chromium builds that have a system HEVC codec installed, yet the actual
 *   decode throws "EncodingError: Decoding error" at runtime. Using libav.js
 *   unconditionally avoids this false-positive and works on every platform.
 *   On hardware-accelerated platforms (macOS, Windows) the WASM decode is
 *   slightly slower but correct.
 *
 * The libav.js .wasm.mjs build runs WASM synchronously on the calling thread.
 * To prevent blocking the main thread during seeking (which decodes every
 * frame from the previous keyframe — potentially hundreds of frames on a 4K
 * GoPro file), the decoder is wrapped in a dedicated Web Worker.  Frame pixel
 * data is transferred (zero-copy) from the worker to the main thread.
 *
 * Loaded lazily: the 2 MB WASM binary is only fetched on first use.
 */

import { CustomVideoDecoder, VideoSample, EncodedPacket, registerDecoder } from 'mediabunny';
import type { VideoSamplePixelFormat } from 'mediabunny';

// ── AV_PIX_FMT → VideoSamplePixelFormat ──────────────────────────────────
// Numeric values are the stable FFmpeg AVPixelFormat enum constants.
const AV_PIX_FMT_MAP: Record<number, VideoSamplePixelFormat> = {
  0: 'I420', // AV_PIX_FMT_YUV420P
  4: 'I422', // AV_PIX_FMT_YUV422P
  5: 'I444', // AV_PIX_FMT_YUV444P
  12: 'I420', // AV_PIX_FMT_YUVJ420P  (full-range, same layout as I420)
  13: 'I422', // AV_PIX_FMT_YUVJ422P  (full-range)
  14: 'I444', // AV_PIX_FMT_YUVJ444P  (full-range)
  23: 'NV12', // AV_PIX_FMT_NV12
  63: 'I420P10', // AV_PIX_FMT_YUV420P10LE
};

// AVPixelFormats where the data is inherently full-range (JPEG variants).
const AV_PIX_FMT_FULL_RANGE = new Set([12, 13, 14]); // YUVJ420P, YUVJ422P, YUVJ444P

// Chroma plane counts per format (planes beyond the first luma plane)
const CHROMA_PLANES: Partial<Record<VideoSamplePixelFormat, 1 | 2>> = {
  I420: 2,
  I420P10: 2,
  I420P12: 2,
  I422: 2,
  I422P10: 2,
  I422P12: 2,
  I444: 2,
  I444P10: 2,
  I444P12: 2,
  NV12: 1,
};

// ── Color space maps (FFmpeg enum → WebCodecs string) ────────────────────────
const AV_COL_PRI: Record<number, string> = {
  1: 'bt709',
  4: 'bt470m',
  5: 'bt470bg',
  6: 'smpte170m',
  7: 'smpte240m',
  9: 'bt2020',
  11: 'smpte431',
  12: 'smpte432',
};

const AV_COL_TRC: Record<number, string> = {
  1: 'bt709',
  4: 'gamma22',
  5: 'gamma28',
  6: 'smpte170m',
  7: 'smpte240m',
  8: 'linear',
  13: 'iec61966-2-1',
  14: 'bt2020-10',
  15: 'bt2020-12',
  16: 'pq',
  18: 'hlg',
};

const AV_COL_SPC: Record<number, string> = {
  0: 'rgb',
  1: 'bt709',
  4: 'fcc',
  5: 'bt470bg',
  6: 'smpte170m',
  7: 'smpte240m',
  9: 'bt2020-ncl',
  10: 'bt2020-cl',
};

// AVColorRange: 2 = full (JPEG/PC)
const AV_COL_RANGE_FULL = 2;

// ── Decoder ───────────────────────────────────────────────────────────────
export class HevcFallbackDecoder extends CustomVideoDecoder {
  private worker: Worker | null = null;
  // Resolve/reject for the single in-flight worker request.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolve: ((v: any) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    return codec === 'hevc';
  }

  async init(): Promise<void> {
    window.dispatchEvent(new CustomEvent('libavfallback', { detail: 'hevc' }));
    this.worker = new Worker(new URL('./hevcWorker.js', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; message?: string };
      if (msg.type === 'error') {
        this.reject?.(new Error(`hevcWorker: ${msg.message ?? 'unknown error'}`));
      } else {
        this.resolve?.(e.data);
      }
      this.resolve = this.reject = null;
    };

    this.worker.onerror = (e) => {
      this.reject?.(new Error(`hevcWorker onerror: ${e.message}`));
      this.resolve = this.reject = null;
    };

    let extradata: Uint8Array | undefined;
    if (this.config.description) {
      const d = this.config.description;
      extradata = d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer);
    }

    await this.send({
      type: 'init',
      width: this.config.codedWidth ?? 0,
      height: this.config.codedHeight ?? 0,
      extradata,
    });
  }

  private send(msg: object, transfers: Transferable[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.worker!.postMessage(msg, transfers);
    });
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.worker) return;
    const pts = Math.round(packet.timestamp * 1_000_000);
    const data = packet.data.slice(); // copy so we own the buffer for transfer
    const resp = (await this.send({ type: 'decode', data, pts, flags: packet.type === 'key' ? 1 : 0 }, [
      data.buffer,
    ])) as { frames: unknown[] };
    this.emitFrames(resp.frames);
  }

  async flush(): Promise<void> {
    if (!this.worker) return;
    const resp = (await this.send({ type: 'flush' })) as { frames: unknown[] };
    this.emitFrames(resp.frames);
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    await this.send({ type: 'close' });
    this.worker.terminate();
    this.worker = null;
  }

  private _loggedFirstFrame = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitFrames(frames: any[]): void {
    for (const frame of frames) {
      const format = AV_PIX_FMT_MAP[frame.format as number];
      if (!this._loggedFirstFrame && format) {
        this._loggedFirstFrame = true;
        console.log(
          '[hevcDecoder] first frame:',
          `pix_fmt=${frame.format as number}(${format})`,
          `primaries=${frame.color_primaries as number}`,
          `trc=${frame.color_trc as number}`,
          `space=${frame.color_space as number}`,
          `range=${frame.color_range as number}`,
          `config.colorSpace=${JSON.stringify(this.config.colorSpace ?? null)}`,
        );
      }
      if (!format) {
        console.warn(`HevcFallbackDecoder: unsupported pixel format ${frame.format as number}; skipping`);
        continue;
      }

      const w = frame.width as number;
      const h = frame.height as number;

      const layout = this.packedLayout(format, w, h);

      let displayWidth = w;
      let displayHeight = h;
      const sar = frame.sample_aspect_ratio as [number, number] | undefined;
      if (sar && sar[0] > 0 && sar[1] > 0 && sar[0] !== sar[1]) {
        const aspect = sar[0] / sar[1];
        if (aspect > 1) {
          displayWidth = Math.round(w * aspect);
        } else {
          displayHeight = Math.round(h / aspect);
        }
      }

      const pixelFmtIdx = frame.format as number;
      const fullRange = AV_PIX_FMT_FULL_RANGE.has(pixelFmtIdx) || (frame.color_range as number) === AV_COL_RANGE_FULL;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const colorSpace: VideoColorSpaceInit = this.config.colorSpace ?? {
        primaries: AV_COL_PRI[frame.color_primaries as number] as any,
        transfer: AV_COL_TRC[frame.color_trc as number] as any,
        matrix: AV_COL_SPC[frame.color_space as number] as any,
        fullRange,
      };

      const sample = new VideoSample(frame.data as Uint8Array, {
        format,
        codedWidth: w,
        codedHeight: h,
        displayWidth,
        displayHeight,
        timestamp: ((frame.pts as number) ?? 0) / 1_000_000,
        duration: 0,
        layout,
        colorSpace,
      });

      this.onSample(sample);
    }
  }

  private packedLayout(format: VideoSamplePixelFormat, w: number, h: number): { offset: number; stride: number }[] {
    const yStride = w;
    const ySize = yStride * h;
    const nChroma = CHROMA_PLANES[format] ?? 2;

    if (format === 'NV12') {
      return [
        { offset: 0, stride: w },
        { offset: ySize, stride: w },
      ];
    }

    const is422 = format.startsWith('I422');
    const is444 = format.startsWith('I444');
    const chromaW = is444 ? w : w >> 1;
    const chromaH = is422 || is444 ? h : h >> 1;
    const uvStride = chromaW;
    const uvSize = uvStride * chromaH;

    if (nChroma === 2) {
      return [
        { offset: 0, stride: yStride },
        { offset: ySize, stride: uvStride },
        { offset: ySize + uvSize, stride: uvStride },
      ];
    }

    return [{ offset: 0, stride: yStride }];
  }
}

registerDecoder(HevcFallbackDecoder);
