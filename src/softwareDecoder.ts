/**
 * Software WebCodecs decoder wrapper.
 *
 * On some Linux Chromium builds, VideoDecoder.isConfigSupported() reports
 * H.264 (and other codecs) as supported, but the hardware-accelerated decode
 * path fails at runtime with "EncodingError: Decoding error".  The fix is to
 * configure the VideoDecoder with hardwareAcceleration:'prefer-software',
 * which uses the browser's built-in software decoder instead.
 *
 * This decoder is registered for any codec where native software decoding
 * (prefer-software) is available.  It takes priority over mediabunny's default
 * WebCodecs path, which uses no-preference and therefore picks hardware first.
 */

import {
  CustomVideoDecoder,
  VideoSample,
  EncodedPacket,
  registerDecoder,
} from 'mediabunny';
import type { VideoCodec } from 'mediabunny';

// Codecs to probe for software support at startup.
// We don't probe HEVC — it is always handled by the libav.js fallback.
const PROBE_CODECS: Array<{ mediabunny: VideoCodec; webcodecs: string }> = [
  { mediabunny: 'avc', webcodecs: 'avc1.42E01E' },
  { mediabunny: 'vp9', webcodecs: 'vp09.00.10.08' },
  { mediabunny: 'av1', webcodecs: 'av01.0.04M.08' },
];

// Codec → software decode available (null = check still pending)
const softwareOk = new Map<VideoCodec, boolean | null>(
  PROBE_CODECS.map(c => [c.mediabunny, null]),
);

// Kick off all probes at module load time so results are ready before any
// file is opened.
const _probesDone: Promise<void> = (async () => {
  if (typeof VideoDecoder === 'undefined') {
    for (const { mediabunny } of PROBE_CODECS) softwareOk.set(mediabunny, false);
    return;
  }
  await Promise.all(PROBE_CODECS.map(async ({ mediabunny, webcodecs }) => {
    try {
      const r = await VideoDecoder.isConfigSupported({
        codec: webcodecs,
        codedWidth: 1280,
        codedHeight: 720,
        hardwareAcceleration: 'prefer-software',
      });
      softwareOk.set(mediabunny, r.supported === true);
    } catch {
      softwareOk.set(mediabunny, false);
    }
  }));
})();

// ── Decoder ───────────────────────────────────────────────────────────────
export class SoftwareWebCodecsDecoder extends CustomVideoDecoder {
  private decoder: VideoDecoder | null = null;

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    const ok = softwareOk.get(codec as VideoCodec);
    // ok === null  →  probe still in flight; default to using this decoder
    //               (worst case: one extra software-mode init on a working system)
    // ok === true  →  software confirmed available
    // ok === false →  software not available; let mediabunny try its own path
    return ok !== false && (codec === 'avc' || codec === 'vp9');
    // av1: typically works fine via hardware/software without this wrapper.
    // Extend the condition if AV1 also starts failing.
  }

  async init(): Promise<void> {
    await _probesDone;
    if (softwareOk.get(this.codec as VideoCodec) === false) {
      throw new Error(`SoftwareWebCodecsDecoder: software ${this.codec} not available`);
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        // VideoSample takes ownership of the VideoFrame and closes it when done.
        // Do NOT call frame.close() here — the frame would be invalidated before
        // mediabunny draws it asynchronously.
        const sample = new VideoSample(frame, {
          timestamp: frame.timestamp / 1_000_000,  // µs → seconds
        });
        this.onSample(sample);
      },
      error: (e) => {
        console.error(`SoftwareWebCodecsDecoder (${this.codec}) error:`, e);
      },
    });

    // configure() is synchronous; on some platforms (e.g. iOS Safari where
    // 'prefer-software' is not a recognised HardwareAcceleration value) it may
    // throw a TypeError or transition the decoder to 'closed' state immediately.
    // Either case must propagate as an init() failure so mediabunny can fall
    // back to its own WebCodecs path without 'prefer-software'.
    try {
      this.decoder.configure({
        ...this.config,
        hardwareAcceleration: 'prefer-software',
      });
    } catch (e) {
      this.decoder.close();
      this.decoder = null;
      throw new Error(`SoftwareWebCodecsDecoder: configure threw for ${this.codec}: ${e}`);
    }
    if (this.decoder.state !== 'configured') {
      const state = this.decoder.state;
      this.decoder.close();
      this.decoder = null;
      throw new Error(`SoftwareWebCodecsDecoder: unexpected state "${state}" after configure for ${this.codec}`);
    }
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.decoder) return;
    this.decoder.decode(new EncodedVideoChunk({
      type: packet.type === 'key' ? 'key' : 'delta',
      timestamp: Math.round(packet.timestamp * 1_000_000),
      duration: Math.round(packet.duration * 1_000_000),
      data: packet.data,
    }));
  }

  async flush(): Promise<void> {
    if (!this.decoder) return;
    await this.decoder.flush();
  }

  async close(): Promise<void> {
    if (!this.decoder) return;
    this.decoder.close();
    this.decoder = null;
  }
}

registerDecoder(SoftwareWebCodecsDecoder);
