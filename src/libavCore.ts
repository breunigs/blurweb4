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

// AVColorRange: 2 = full (JPEG/PC range)
const AV_COL_RANGE_FULL = 2;

// ── FFmpeg constants ───────────────────────────────────────────────────────

const AVMEDIA_TYPE_VIDEO = 0;

// Decoder names as registered in the WASM binary.
// AVC: built-in FFmpeg h264 decoder.
// AV1: libaom decoder — registered as 'libaom-av1', NOT 'av1'.
// codec_id is intentionally omitted from the codecpar so ff_init_decoder
// infers it from the decoder found by name, avoiding hardcoded-value mismatches
// across FFmpeg versions.
const CODEC_NAME: Partial<Record<VideoCodec, string>> = {
  avc: 'h264',
  av1: 'libaom-av1',
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
    const codecName = CODEC_NAME[this.codec];
    if (!codecName) {
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

    // codec_id is omitted — ff_init_decoder infers it from the decoder found by name,
    // avoiding mismatches from hardcoded values that vary across FFmpeg versions.
    [, this.c, this.pkt, this.frame] = (await this.libav.ff_init_decoder(codecName, {
      codecpar: {
        codec_type: AVMEDIA_TYPE_VIDEO,
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
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(this.c, this.pkt, this.frame, [
      {
        data: packet.data,
        pts,
        dts: pts,
        flags: packet.type === 'key' ? 1 : 0,
        time_base_num: 1,
        time_base_den: 1_000_000,
      },
    ]);
    this.emitFrames(rawFrames);
  }

  async flush(): Promise<void> {
    if (!this.libav) return;
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(this.c, this.pkt, this.frame, [], true);
    this.emitFrames(rawFrames);
  }

  async close(): Promise<void> {
    if (!this.libav) return;
    await this.libav.ff_free_decoder(this.c, this.pkt, this.frame);
    this.libav = null;
    this.c = this.pkt = this.frame = 0;
  }

  private _loggedFirstFrame = false;

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
      // Use the layout returned by libav.js default copyout mode — it carries the
      // actual AVFrame linesizes, which include alignment padding and are correct
      // for all bit-depths (video_packed mode is broken for 10-bit planar formats).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layout = frame.layout as { offset: number; stride: number }[] | undefined;

      let displayWidth = w;
      let displayHeight = h;
      const sar = frame.sample_aspect_ratio as [number, number] | undefined;
      if (sar && sar[0] > 0 && sar[1] > 0 && sar[0] !== sar[1]) {
        const aspect = sar[0] / sar[1];
        if (aspect > 1) displayWidth = Math.round(w * aspect);
        else displayHeight = Math.round(h / aspect);
      }

      const pixelFmtIdx = frame.format as number;
      const fullRange = AV_PIX_FMT_FULL_RANGE.has(pixelFmtIdx) || (frame.color_range as number) === AV_COL_RANGE_FULL;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const colorSpace: VideoColorSpaceInit = {
        primaries: AV_COL_PRI[frame.color_primaries as number] as any,
        transfer: AV_COL_TRC[frame.color_trc as number] as any,
        matrix: AV_COL_SPC[frame.color_space as number] as any,
        fullRange,
      };

      if (!this._loggedFirstFrame) {
        this._loggedFirstFrame = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layoutSummary = (frame.layout as any[])?.map((p: { offset: number; stride: number }) => `${p.offset}+${p.stride}`).join(', ');
        console.log(
          `[libavCore] first frame: codec=${this.codec}`,
          `pix_fmt=${frame.format as number}(${format})`,
          `w=${w} h=${h} displayW=${displayWidth} displayH=${displayHeight}`,
          `dataType=${Object.prototype.toString.call(frame.data)}`,
          `dataLen=${(frame.data as Uint8Array)?.length}`,
          `layout=[${layoutSummary ?? 'none'}]`,
          `sar=${JSON.stringify(sar)}`,
          `pts=${frame.pts as number}`,
          `color_primaries=${frame.color_primaries as number}`,
          `color_trc=${frame.color_trc as number}`,
          `color_space=${frame.color_space as number}`,
          `color_range=${frame.color_range as number}`,
          `resolved colorSpace=${JSON.stringify(colorSpace)}`,
        );
      }

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

      const init = {
        format: sampleFormat,
        codedWidth: w,
        codedHeight: h,
        displayWidth,
        displayHeight,
        timestamp: ((frame.pts as number) ?? 0) / 1_000_000,
        duration: 0,
        layout: sampleLayout,
        colorSpace,
      };

      try {
        this.onSample(new VideoSample(sampleData, init));
      } catch (err) {
        console.error(
          `[libavCore] VideoSample constructor threw for codec=${this.codec}:`,
          String(err),
          JSON.stringify({ ...init, layout: init.layout?.map((p) => `${p.offset}+${p.stride}`) }),
          `dataLen=${sampleData.length}`,
        );
        throw err;
      }
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
