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
 * Loaded lazily: the 2 MB WASM binary is only fetched on first use.
 */

import {
  CustomVideoDecoder,
  VideoSample,
  EncodedPacket,
  registerDecoder,
} from 'mediabunny';
import type { VideoSamplePixelFormat } from 'mediabunny';

// ── Vendor file paths ─────────────────────────────────────────────────────
// Resolved against the page origin at runtime — keeps esbuild from trying
// to bundle these files as part of the application bundle.
const LIBAV_MJS = '/vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs';

// ── AV_PIX_FMT → VideoSamplePixelFormat ──────────────────────────────────
// Numeric values are the stable FFmpeg AVPixelFormat enum constants.
const AV_PIX_FMT_MAP: Record<number, VideoSamplePixelFormat> = {
  0:  'I420',     // AV_PIX_FMT_YUV420P
  4:  'I422',     // AV_PIX_FMT_YUV422P
  5:  'I444',     // AV_PIX_FMT_YUV444P
  12: 'I420',     // AV_PIX_FMT_YUVJ420P  (full-range, same layout as I420)
  13: 'I422',     // AV_PIX_FMT_YUVJ422P  (full-range)
  14: 'I444',     // AV_PIX_FMT_YUVJ444P  (full-range)
  23: 'NV12',     // AV_PIX_FMT_NV12
  63: 'I420P10',  // AV_PIX_FMT_YUV420P10LE
};

// AVPixelFormats where the data is inherently full-range (JPEG variants).
// For these, fullRange must be true regardless of the color_range field.
const AV_PIX_FMT_FULL_RANGE = new Set([12, 13, 14]); // YUVJ420P, YUVJ422P, YUVJ444P

// Chroma plane counts per format (planes beyond the first luma plane)
const CHROMA_PLANES: Partial<Record<VideoSamplePixelFormat, 1 | 2>> = {
  'I420': 2, 'I420P10': 2, 'I420P12': 2,
  'I422': 2, 'I422P10': 2, 'I422P12': 2,
  'I444': 2, 'I444P10': 2, 'I444P12': 2,
  'NV12': 1,  // NV12 has one interleaved UV plane
};

// ── Color space maps (FFmpeg enum → WebCodecs string) ────────────────────────
// Stable across FFmpeg 4–8. Values from avutil/pixfmt.h and colorspace.h.

// AVColorPrimaries → VideoColorSpaceInit.primaries
// DOM types only list a subset; cast to string to allow runtime values (bt2020 etc.)
const AV_COL_PRI: Record<number, string> = {
  1:  'bt709',
  4:  'bt470m',
  5:  'bt470bg',
  6:  'smpte170m',
  7:  'smpte240m',
  9:  'bt2020',
  11: 'smpte431',
  12: 'smpte432',
};

// AVColorTransferCharacteristic → VideoColorSpaceInit.transfer
const AV_COL_TRC: Record<number, string> = {
  1:  'bt709',
  4:  'gamma22',
  5:  'gamma28',
  6:  'smpte170m',
  7:  'smpte240m',
  8:  'linear',
  13: 'iec61966-2-1',  // sRGB
  14: 'bt2020-10',
  15: 'bt2020-12',
  16: 'pq',            // SMPTE ST 2084 (HDR10)
  18: 'hlg',           // ARIB STD-B67 (HLG HDR)
};

// AVColorSpace → VideoColorSpaceInit.matrix
const AV_COL_SPC: Record<number, string> = {
  0:  'rgb',
  1:  'bt709',
  4:  'fcc',
  5:  'bt470bg',
  6:  'smpte170m',
  7:  'smpte240m',
  9:  'bt2020-ncl',
  10: 'bt2020-cl',
};

// AVColorRange: 1 = limited (MPEG/TV), 2 = full (JPEG/PC)
const AV_COL_RANGE_FULL    = 2;

// FFmpeg constants (stable across FFmpeg 4–8)
const AVMEDIA_TYPE_VIDEO = 0;
const AV_CODEC_ID_HEVC   = 173;

// ── Decoder ───────────────────────────────────────────────────────────────
export class HevcFallbackDecoder extends CustomVideoDecoder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private libav: any = null;
  private c     = 0;  // AVCodecContext*
  private pkt   = 0;  // AVPacket*
  private frame = 0;  // AVFrame*

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    // Intercept all HEVC regardless of platform WebCodecs support.
    // See module comment for why we don't use isConfigSupported() here.
    return codec === 'hevc';
  }

  async init(): Promise<void> {
    // Dynamic import via runtime-computed URL — esbuild cannot statically
    // follow this and will leave the import() expression in the output as-is.
    const libavUrl = new URL(LIBAV_MJS, document.baseURI).href;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const { default: LibAVFactory } = await (new Function('u', 'return import(u)'))(libavUrl) as {
      default: (opts?: object) => Promise<unknown>;
    };
    this.libav = await LibAVFactory();

    // hvcC-format extradata from the WebCodecs VideoDecoderConfig.description
    let extradata: Uint8Array | undefined;
    if (this.config.description) {
      const d = this.config.description;
      extradata = d instanceof Uint8Array
        ? d
        : new Uint8Array(d as ArrayBuffer);
    }

    [, this.c, this.pkt, this.frame] = await this.libav.ff_init_decoder('hevc', {
      codecpar: {
        codec_type: AVMEDIA_TYPE_VIDEO,
        codec_id:   AV_CODEC_ID_HEVC,
        format:     -1,   // AV_PIX_FMT_NONE — decoder decides
        width:      this.config.codedWidth  ?? 0,
        height:     this.config.codedHeight ?? 0,
        extradata,
      },
      time_base: [1, 1_000_000],  // microseconds
    }) as [number, number, number, number];
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.libav) return;

    const pts = Math.round(packet.timestamp * 1_000_000);
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(
      this.c, this.pkt, this.frame,
      [{
        data:          packet.data,
        pts,
        dts:           pts,
        flags:         packet.type === 'key' ? 1 : 0,
        time_base_num: 1,
        time_base_den: 1_000_000,
      }],
      { copyoutFrame: 'video_packed' },
    );
    this.emitFrames(rawFrames);
  }

  async flush(): Promise<void> {
    if (!this.libav) return;
    const rawFrames: unknown[] = await this.libav.ff_decode_multi(
      this.c, this.pkt, this.frame, [],
      { fin: true, copyoutFrame: 'video_packed' },
    );
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

      const w = frame.width  as number;
      const h = frame.height as number;

      // video_packed mode returns stride-free data, so the layout is trivially
      // derived from the plane dimensions.  We compute it explicitly rather
      // than trusting frame.layout, which avoids any stride-padding artefacts
      // (e.g. the yellow band seen when passing libav's padded layout directly
      // to WebCodecs VideoFrame).
      const layout = this.packedLayout(format, w, h);

      // Apply SAR to derive display dimensions, matching the browser's own
      // WebCodecs VideoFrame computation for the same stream.
      let displayWidth  = w;
      let displayHeight = h;
      const sar = frame.sample_aspect_ratio as [number, number] | undefined;
      if (sar && sar[0] > 0 && sar[1] > 0 && sar[0] !== sar[1]) {
        const aspect = sar[0] / sar[1]; // pixel_width / pixel_height
        if (aspect > 1) {
          displayWidth  = Math.round(w * aspect);
        } else {
          displayHeight = Math.round(h / aspect);
        }
      }

      // Use the color space from the container's colr atom (parsed by mediabunny
      // and passed in this.config.colorSpace) — it is more reliable than the
      // per-frame metadata returned by libav.js's video_packed copyout, which
      // often leaves color_primaries/trc/space/range as undefined/0.
      // Fall back to per-frame metadata only when the container has no colr atom.
      const pixelFmtIdx = frame.format as number;
      const fullRange = AV_PIX_FMT_FULL_RANGE.has(pixelFmtIdx)
        || (frame.color_range as number) === AV_COL_RANGE_FULL;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const colorSpace: VideoColorSpaceInit = this.config.colorSpace ?? {
        primaries: AV_COL_PRI[frame.color_primaries as number] as any,
        transfer:  AV_COL_TRC[frame.color_trc       as number] as any,
        matrix:    AV_COL_SPC[frame.color_space     as number] as any,
        fullRange,
      };

      const sample = new VideoSample(frame.data as Uint8Array, {
        format,
        codedWidth:    w,
        codedHeight:   h,
        displayWidth,
        displayHeight,
        timestamp:     ((frame.pts as number) ?? 0) / 1_000_000,
        duration:      0,
        layout,
        colorSpace,
      });

      this.onSample(sample);
    }
  }

  /**
   * Returns the PlaneLayout for tightly-packed (no stride padding) pixel data.
   * This matches the output of libav.js's copyoutFrame:'video_packed' mode.
   */
  private packedLayout(
    format: VideoSamplePixelFormat,
    w: number,
    h: number,
  ): { offset: number; stride: number }[] {
    // Luma plane always occupies w × h bytes with stride = w
    const yStride = w;
    const ySize   = yStride * h;

    const nChroma = CHROMA_PLANES[format] ?? 2;

    if (format === 'NV12') {
      // NV12: Y plane + interleaved UV plane (same width as Y, half height)
      return [
        { offset: 0,     stride: w },      // Y
        { offset: ySize, stride: w },      // UV interleaved
      ];
    }

    // Planar formats: determine chroma sub-sampling from format name
    const is422 = format.startsWith('I422');
    const is444 = format.startsWith('I444');
    const chromaW = is444 ? w : w >> 1;         // I420/I422: half width; I444: full
    const chromaH = (is422 || is444) ? h : h >> 1; // I422/I444: full height; I420: half

    const uvStride = chromaW;
    const uvSize   = uvStride * chromaH;

    if (nChroma === 2) {
      return [
        { offset: 0,               stride: yStride },  // Y
        { offset: ySize,           stride: uvStride },  // U (Cb)
        { offset: ySize + uvSize,  stride: uvStride },  // V (Cr)
      ];
    }

    return [{ offset: 0, stride: yStride }]; // luma-only fallback
  }
}

registerDecoder(HevcFallbackDecoder);
