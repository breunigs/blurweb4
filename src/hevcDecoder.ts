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
  62: 'I420P10', // AV_PIX_FMT_YUV420P10LE
};

// AVPixelFormats where the data is inherently full-range (JPEG variants).
const AV_PIX_FMT_FULL_RANGE = new Set([12, 13, 14]); // YUVJ420P, YUVJ422P, YUVJ444P

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

      // Use the layout returned by libav.js default copyout — it carries the
      // actual AVFrame linesizes, which are correct for all bit-depths.
      // (video_packed mode is broken for 10-bit planar formats.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layout = frame.layout as { offset: number; stride: number }[] | undefined;

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

      // iOS Safari's VideoFrame does not support I420P10. Downscale to 8-bit I420
      // so mediabunny can create a VideoFrame on all platforms.
      let sampleData = frame.data as Uint8Array;
      let sampleLayout = layout;
      let sampleFormat = format;
      if (format === 'I420P10' && layout) {
        const converted = this.downscaleI420P10ToI420(sampleData, layout, w, h);
        sampleData = converted.data;
        sampleLayout = converted.layout;
        sampleFormat = 'I420';
      }

      const sample = new VideoSample(sampleData, {
        format: sampleFormat,
        codedWidth: w,
        codedHeight: h,
        displayWidth,
        displayHeight,
        timestamp: ((frame.pts as number) ?? 0) / 1_000_000,
        duration: 0,
        layout: sampleLayout,
        colorSpace,
      });

      this.onSample(sample);
    }
  }

  // Convert I420P10LE (10-bit, 2 bytes/sample) → I420 (8-bit, 1 byte/sample).
  // iOS Safari's VideoFrame does not support I420P10, so we drop the 2 LSBs.
  // The layout from libav default copyout includes alignment padding between
  // planes, so we must iterate row-by-row using the per-plane stride.
  private downscaleI420P10ToI420(
    data: Uint8Array,
    layout: { offset: number; stride: number }[],
    w: number,
    h: number,
  ): { data: Uint8Array; layout: { offset: number; stride: number }[] } {
    const uvW = w >>> 1;
    const uvH = h >>> 1;
    const yDstStride = w;
    const uvDstStride = uvW;
    const uDstOffset = yDstStride * h;
    const vDstOffset = uDstOffset + uvDstStride * uvH;
    const out = new Uint8Array(vDstOffset + uvDstStride * uvH);

    // 10-bit LE samples: low byte holds bits 0-7, high byte holds bits 8-9.
    // Shift the uint16 value right by 2 to obtain the top 8 bits.
    const view16 = new Uint16Array(data.buffer, data.byteOffset, data.byteLength >>> 1);

    const copyPlane = (srcByteOffset: number, srcByteStride: number, dstByteOffset: number, planeW: number, planeH: number) => {
      const srcBase16 = srcByteOffset >>> 1;
      const srcStride16 = srcByteStride >>> 1;
      for (let row = 0; row < planeH; row++) {
        const s = srcBase16 + row * srcStride16;
        const d = dstByteOffset + row * planeW;
        for (let col = 0; col < planeW; col++) {
          out[d + col] = view16[s + col] >>> 2;
        }
      }
    };

    const [y, u, v] = layout;
    copyPlane(y.offset, y.stride, 0, w, h);
    copyPlane(u.offset, u.stride, uDstOffset, uvW, uvH);
    copyPlane(v.offset, v.stride, vDstOffset, uvW, uvH);

    return {
      data: out,
      layout: [
        { offset: 0, stride: yDstStride },
        { offset: uDstOffset, stride: uvDstStride },
        { offset: vDstOffset, stride: uvDstStride },
      ],
    };
  }
}

// SKIP_HEVC_WASM is set at build time (esbuild define) for Tauri macOS builds
// where native WebCodecs handles HEVC — no WASM fallback needed.
declare const SKIP_HEVC_WASM: boolean;
if (!SKIP_HEVC_WASM) {
  registerDecoder(HevcFallbackDecoder);
}
