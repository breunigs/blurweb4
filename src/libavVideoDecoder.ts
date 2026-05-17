/**
 * libav.js WASM fallback decoder for AVC (H.264) and AV1.
 *
 * Activates only when VideoDecoder is entirely unavailable (typeof VideoDecoder
 * === 'undefined').  When WebCodecs is present but fails at runtime,
 * SmartWebCodecsDecoder handles the libav fallback inline.
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

import { CustomVideoDecoder, EncodedPacket, registerDecoder } from 'mediabunny';
import type { VideoCodec } from 'mediabunny';
import { LibavAvcAv1Core, wasmAvailable, LIBAV_AVC_AV1_CODECS } from './libavCore';
import { areAllWebCodecsFailed } from './softwareDecoder';

export class LibavVideoFallbackDecoder extends CustomVideoDecoder {
  private core: LibavAvcAv1Core | null = null;

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    if (!LIBAV_AVC_AV1_CODECS.has(codec as VideoCodec)) return false;
    // Only activate when WebCodecs is entirely absent (probe-failed all modes because
    // VideoDecoder is undefined).  Runtime failures are handled inline by SmartWebCodecsDecoder.
    if (!wasmAvailable) return false;
    return areAllWebCodecsFailed(codec as VideoCodec);
  }

  async init(): Promise<void> {
    this.core = new LibavAvcAv1Core(
      this.codec as VideoCodec,
      this.config,
      (s) => this.onSample(s),
    );
    await this.core.init();
  }

  async decode(packet: EncodedPacket): Promise<void> {
    await this.core?.decode(packet);
  }

  async flush(): Promise<void> {
    await this.core?.flush();
  }

  async close(): Promise<void> {
    await this.core?.close();
    this.core = null;
  }
}

registerDecoder(LibavVideoFallbackDecoder);
