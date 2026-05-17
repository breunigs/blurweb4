/**
 * Shared libav.js AVC/AV1 decode core.
 *
 * Used by SmartWebCodecsDecoder (inline fallback when all WebCodecs modes fail
 * at runtime) and LibavVideoFallbackDecoder (standalone decoder when WebCodecs
 * is entirely unavailable).
 */

import { VideoSample } from 'mediabunny';
import type { VideoSamplePixelFormat, VideoCodec, EncodedPacket } from 'mediabunny';

// ── Vendor file path ───────────────────────────────────────────────────────

export const LIBAV_AVC_AV1_MJS = new URL(
  '../vendor/libav-avc-av1/libav-6.8.8.0-avc-av1.wasm.mjs',
  import.meta.url,
).href;

// ── Pixel format maps ──────────────────────────────────────────────────────

const AV_PIX_FMT_MAP: Record<number, VideoSamplePixelFormat> = {
  0: 'I420', // AV_PIX_FMT_YUV420P
  4: 'I422', // AV_PIX_FMT_YUV422P
  5: 'I444', // AV_PIX_FMT_YUV444P
  12: 'I420', // AV_PIX_FMT_YUVJ420P (full-range, same layout)
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

const CODEC_ID: Partial<Record<VideoCodec, number>> = {
  avc: 27, // AV_CODEC_ID_H264
  av1: 226, // AV_CODEC_ID_AV1
};

const CODEC_NAME: Partial<Record<VideoCodec, string>> = {
  avc: 'h264',
  av1: 'av1',
};

export const LIBAV_AVC_AV1_CODECS = new Set<VideoCodec>(['avc', 'av1']);

// ── WASM availability probe ────────────────────────────────────────────────
// Checked once at startup so supports() calls stay synchronous.

export let wasmAvailable: boolean | null = null;

(async () => {
  try {
    const resp = await fetch(LIBAV_AVC_AV1_MJS, { method: 'HEAD' });
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

// ── Core decoder ───────────────────────────────────────────────────────────

export class LibavAvcAv1Core {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private libav: any = null;
  private c = 0; // AVCodecContext*
  private pkt = 0; // AVPacket*
  private frame = 0; // AVFrame*

  constructor(
    private readonly codec: VideoCodec,
    private readonly config: VideoDecoderConfig,
    private readonly onSample: (s: VideoSample) => void,
  ) {}

  async init(): Promise<void> {
    const codecId = CODEC_ID[this.codec];
    const codecName = CODEC_NAME[this.codec];
    if (codecId === undefined || !codecName) {
      throw new Error(`LibavAvcAv1Core: unsupported codec ${this.codec}`);
    }

    // Dynamic import via runtime string — prevents esbuild from bundling the vendor file.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const { default: LibAVFactory } = (await new Function('u', 'return import(u)')(LIBAV_AVC_AV1_MJS)) as {
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

    window.dispatchEvent(new CustomEvent('libavfallback', { detail: this.codec }));
    console.log(`[libavVideoDecoder] ${this.codec} decoder initialized`);
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
        console.warn(`LibavAvcAv1Core: unsupported pixel format ${frame.format as number}; skipping`);
        continue;
      }

      const w = frame.width as number;
      const h = frame.height as number;
      const layout = this.computeLayout(format, w, h);

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

  private computeLayout(format: VideoSamplePixelFormat, w: number, h: number): { offset: number; stride: number }[] {
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
