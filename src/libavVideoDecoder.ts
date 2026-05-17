/**
 * libav.js WASM fallback decoder for AVC (H.264) and AV1.
 *
 * Activates only after all WebCodecs hardware-acceleration modes have been
 * proven to fail at runtime for the given codec (tracked by softwareDecoder.ts).
 *
 * Requires: vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs
 *
 * Build instructions (similar to the hevc-aac variant):
 *   mkdir /tmp/libavjs && tar xf node_modules/libav.js/sources/libav.js.tar.xz -C /tmp/libavjs
 *   cp node_modules/libav.js/sources/*.tar.* /tmp/libavjs/
 *   docker build -f /tmp/libavjs/Dockerfile.development -t libavjs-builder /tmp/libavjs
 *   # Inside the container, run config/mkconfig.js:
 *   docker run --rm -v /tmp/libavjs:/work -w /work libavjs-builder bash -c \
 *     "cd configs && node mkconfig.js avc-av1 '[\"format-mp4\",\"parser-h264\",\"decoder-h264\",\"parser-av1\",\"decoder-libaom_av1\",\"swscale\"]' && cd .. && MAKEFLAGS=-j\$(nproc) make dist/libav-6.8.8.0-avc-av1.wasm.mjs"
 *   cp /tmp/libavjs/dist/libav-6.8.8.0-avc-av1.wasm.{mjs,wasm} vendor/libav-avc-av1/
 *
 * Note: H.264 and AV1 (libaom) are patent/licensing-sensitive — build and
 * distribute only for internal/local use, consistent with existing hevc-aac usage.
 */

import { CustomVideoDecoder, VideoSample, EncodedPacket, registerDecoder } from 'mediabunny';
import type { VideoSamplePixelFormat, VideoCodec } from 'mediabunny';
import { areAllWebCodecsFailed } from './softwareDecoder';

// ── Vendor file path ───────────────────────────────────────────────────────

const LIBAV_MJS = new URL('../vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs', import.meta.url).href;

// ── Pixel format maps (same as hevcDecoder.ts) ─────────────────────────────

const AV_PIX_FMT_MAP: Record<number, VideoSamplePixelFormat> = {
  0: 'I420', // AV_PIX_FMT_YUV420P
  4: 'I422', // AV_PIX_FMT_YUV422P
  5: 'I444', // AV_PIX_FMT_YUV444P
  12: 'I420', // AV_PIX_FMT_YUVJ420P  (full-range, same layout)
  23: 'NV12', // AV_PIX_FMT_NV12
  63: 'I420P10', // AV_PIX_FMT_YUV420P10LE
};

const CHROMA_PLANES: Partial<Record<VideoSamplePixelFormat, 1 | 2>> = {
  I420: 2,
  I420P10: 2,
  I422: 2,
  I444: 2,
  NV12: 1,
};

// ── FFmpeg constants ───────────────────────────────────────────────────────

const AVMEDIA_TYPE_VIDEO = 0;

// Stable AV_CODEC_ID values across FFmpeg 4–8.
const CODEC_ID: Partial<Record<VideoCodec, number>> = {
  avc: 27, // AV_CODEC_ID_H264
  av1: 226, // AV_CODEC_ID_AV1
};
const CODEC_NAME: Partial<Record<VideoCodec, string>> = {
  avc: 'h264',
  av1: 'av1',
};

const HANDLED_CODECS = new Set<VideoCodec>(['avc', 'av1']);

// ── WASM availability probe ────────────────────────────────────────────────
// Check once at startup so supports() stays synchronous.

let wasmAvailable: boolean | null = null;

(async () => {
  try {
    const resp = await fetch(LIBAV_MJS, { method: 'HEAD' });
    wasmAvailable = resp.ok;
  } catch {
    wasmAvailable = false;
  }
  if (wasmAvailable) {
    console.log('[libavVideoDecoder] WASM available — libav AVC/AV1 fallback ready');
  } else {
    console.log('[libavVideoDecoder] WASM not found — libav AVC/AV1 fallback disabled');
  }
})();

// ── Decoder ───────────────────────────────────────────────────────────────

export class LibavVideoFallbackDecoder extends CustomVideoDecoder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private libav: any = null;
  private c = 0; // AVCodecContext*
  private pkt = 0; // AVPacket*
  private frame = 0; // AVFrame*

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    if (!HANDLED_CODECS.has(codec as VideoCodec)) return false;
    // Only claim the codec once all WebCodecs paths have failed AND we know the WASM exists.
    // wasmAvailable === null means the HEAD check is still in flight — conservatively skip.
    if (!wasmAvailable) return false;
    return areAllWebCodecsFailed(codec as VideoCodec);
  }

  async init(): Promise<void> {
    const codec = this.codec as VideoCodec;
    const codecId = CODEC_ID[codec];
    const codecName = CODEC_NAME[codec];
    if (codecId === undefined || !codecName) {
      throw new Error(`LibavVideoFallbackDecoder: unsupported codec ${codec}`);
    }

    // Dynamic import via runtime string — prevents esbuild from bundling the vendor file.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const { default: LibAVFactory } = (await new Function('u', 'return import(u)')(LIBAV_MJS)) as {
      default: (opts?: object) => Promise<unknown>;
    };
    this.libav = await LibAVFactory();

    let extradata: Uint8Array | undefined;
    if (this.config.description) {
      const d = this.config.description;
      extradata = d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer);
    }

    [, this.c, this.pkt, this.frame] = (await this.libav.ff_init_decoder(codecName, {
      codecpar: {
        codec_type: AVMEDIA_TYPE_VIDEO,
        codec_id: codecId,
        format: -1,
        width: this.config.codedWidth ?? 0,
        height: this.config.codedHeight ?? 0,
        extradata,
      },
      time_base: [1, 1_000_000],
    })) as [number, number, number, number];

    window.dispatchEvent(new CustomEvent('libavfallback', { detail: codec }));
    console.log(`[libavVideoDecoder] ${codec} (${codecName}) decoder initialized`);
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.libav) return;
    const pts = Math.round(packet.timestamp * 1_000_000);
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(
      this.c,
      this.pkt,
      this.frame,
      [
        {
          data: packet.data,
          pts,
          dts: pts,
          flags: packet.type === 'key' ? 1 : 0,
          time_base_num: 1,
          time_base_den: 1_000_000,
        },
      ],
      { copyoutFrame: 'video_packed' },
    );
    this.emitFrames(rawFrames);
  }

  async flush(): Promise<void> {
    if (!this.libav) return;
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(this.c, this.pkt, this.frame, [], {
      fin: true,
      copyoutFrame: 'video_packed',
    });
    this.emitFrames(rawFrames);
  }

  async close(): Promise<void> {
    if (!this.libav) return;
    await this.libav.ff_free_decoder(this.c, this.pkt, this.frame);
    this.libav = null;
    this.c = this.pkt = this.frame = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitFrames(frames: any[]): void {
    for (const frame of frames) {
      const format = AV_PIX_FMT_MAP[frame.format as number];
      if (!format) {
        console.warn(`LibavVideoFallbackDecoder: unsupported pixel format ${frame.format as number}; skipping`);
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
        if (aspect > 1) displayWidth = Math.round(w * aspect);
        else displayHeight = Math.round(h / aspect);
      }

      this.onSample(
        new VideoSample(frame.data as Uint8Array, {
          format,
          codedWidth: w,
          codedHeight: h,
          displayWidth,
          displayHeight,
          timestamp: ((frame.pts as number) ?? 0) / 1_000_000,
          duration: 0,
          layout,
        }),
      );
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

registerDecoder(LibavVideoFallbackDecoder);
