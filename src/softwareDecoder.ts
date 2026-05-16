/**
 * Smart WebCodecs decoder with hardware-acceleration fallback chain.
 *
 * Probes prefer-hardware, prefer-software, and no-preference for each codec
 * at startup using isConfigSupported().  At decode time the best available
 * mode is tried first.
 *
 * Runtime error handling:
 *   All EncodedVideoChunks are buffered in pendingPackets.  If the active
 *   VideoDecoder errors (error callback fires → decoder state = 'closed'),
 *   our flush() detects this, switches to the next available mode, and
 *   replays all buffered packets through the new decoder.  This transparently
 *   handles browsers that report false-positive isConfigSupported() results.
 *
 * Note: for streams where the failed decoder produced some frames before
 * erroring, the replay will re-emit those frames (potential duplicates).
 * In practice the failing case is always the first packet.
 *
 * Codecs handled: avc, vp9, av1, vp8  (everything except hevc).
 *
 * If all WebCodecs modes fail, areAllWebCodecsFailed(codec) returns true,
 * allowing libavVideoDecoder.ts to take over.
 */

import {
  CustomVideoDecoder,
  VideoSample,
  EncodedPacket,
  registerDecoder,
} from 'mediabunny';
import type { VideoCodec } from 'mediabunny';

// ── Codec / mode tables ────────────────────────────────────────────────────

const CODECS: Array<{ mediabunny: VideoCodec; webcodecs: string }> = [
  { mediabunny: 'avc', webcodecs: 'avc1.42E01E' },
  { mediabunny: 'vp9', webcodecs: 'vp09.00.10.08' },
  { mediabunny: 'av1', webcodecs: 'av01.0.04M.08' },
  { mediabunny: 'vp8', webcodecs: 'vp8' },
];

type HwMode = 'prefer-hardware' | 'prefer-software' | 'no-preference';
const ALL_MODES: HwMode[] = ['prefer-hardware', 'prefer-software', 'no-preference'];

type ModeStatus = 'untested' | 'probe-ok' | 'probe-fail' | 'runtime-fail';
const modeStatus = new Map<VideoCodec, Map<HwMode, ModeStatus>>();

for (const { mediabunny } of CODECS) {
  const m = new Map<HwMode, ModeStatus>();
  for (const mode of ALL_MODES) m.set(mode, 'untested');
  modeStatus.set(mediabunny, m);
}

// ── Startup probes ────────────────────────────────────────────────────────

const _probesDone: Promise<void> = (async () => {
  if (typeof VideoDecoder === 'undefined') {
    for (const { mediabunny } of CODECS) {
      const m = modeStatus.get(mediabunny)!;
      for (const mode of ALL_MODES) m.set(mode, 'probe-fail');
    }
    return;
  }
  await Promise.all(
    CODECS.flatMap(({ mediabunny, webcodecs }) =>
      ALL_MODES.map(async (mode) => {
        const m = modeStatus.get(mediabunny)!;
        try {
          const r = await VideoDecoder.isConfigSupported({
            codec: webcodecs,
            codedWidth: 1280,
            codedHeight: 720,
            hardwareAcceleration: mode,
          });
          m.set(mode, r.supported === true ? 'probe-ok' : 'probe-fail');
        } catch {
          m.set(mode, 'probe-fail');
        }
      }),
    ),
  );
  for (const { mediabunny } of CODECS) {
    const m = modeStatus.get(mediabunny)!;
    const summary = ALL_MODES.map(mode => `${mode}=${m.get(mode)}`).join(', ');
    console.log(`[webCodecsDecoder] probe ${mediabunny}: ${summary}`);
  }
})();

// ── Exported helper ───────────────────────────────────────────────────────

export function areAllWebCodecsFailed(codec: VideoCodec): boolean {
  const m = modeStatus.get(codec);
  if (!m) return true;
  return ALL_MODES.every(mode => {
    const s = m.get(mode)!;
    return s === 'probe-fail' || s === 'runtime-fail';
  });
}

function availableModes(codec: VideoCodec): HwMode[] {
  const m = modeStatus.get(codec);
  if (!m) return [];
  return ALL_MODES.filter(mode => {
    const s = m.get(mode)!;
    return s !== 'probe-fail' && s !== 'runtime-fail';
  });
}

// ── Decoder ───────────────────────────────────────────────────────────────

export class SmartWebCodecsDecoder extends CustomVideoDecoder {
  private decoder: VideoDecoder | null = null;
  private runtimeError: Error | null = null;
  /**
   * All EncodedVideoChunks sent since the last successful flush.
   * Kept so we can replay them if the decoder mode needs to switch.
   */
  private pendingPackets: EncodedVideoChunk[] = [];

  static override supports(codec: string, _config: VideoDecoderConfig): boolean {
    if (codec === 'hevc') return false;
    if (typeof VideoDecoder === 'undefined') return false;
    const vc = codec as VideoCodec;
    if (!modeStatus.has(vc)) return false;
    return ALL_MODES.some(mode => {
      const s = modeStatus.get(vc)!.get(mode)!;
      return s !== 'probe-fail' && s !== 'runtime-fail';
    });
  }

  /**
   * Create and configure a VideoDecoder for the given mode.
   * Returns null if configure fails or transitions to a bad state.
   * Marks the mode as 'runtime-fail' on any failure.
   */
  private makeDecoder(mode: HwMode): VideoDecoder | null {
    const codec = this.codec as VideoCodec;
    try {
      const dec = new VideoDecoder({
        output: (frame) => {
          this.onSample(new VideoSample(frame, { timestamp: frame.timestamp / 1_000_000 }));
        },
        error: (e) => {
          console.error(`[webCodecsDecoder] runtime error (${codec} / ${mode}):`, e);
          modeStatus.get(codec)?.set(mode, 'runtime-fail');
          this.runtimeError = e instanceof Error ? e : new Error(String(e));
        },
      });
      dec.configure({ ...this.config, hardwareAcceleration: mode });
      if (dec.state !== 'configured') {
        dec.close();
        modeStatus.get(codec)?.set(mode, 'runtime-fail');
        console.warn(`[webCodecsDecoder] ${codec}/${mode}: state "${dec.state}" after configure`);
        return null;
      }
      return dec;
    } catch (e) {
      modeStatus.get(codec)?.set(mode, 'runtime-fail');
      console.warn(`[webCodecsDecoder] ${codec}/${mode}: configure threw:`, e);
      return null;
    }
  }

  /**
   * Close the current decoder and reinitialize using the next available mode.
   * After this, this.decoder is either a fresh decoder or null (all modes failed).
   */
  private reinitWithNextMode(): void {
    this.runtimeError = null;
    // Close old decoder if not already closed.
    if (this.decoder && this.decoder.state !== 'closed') {
      try { this.decoder.close(); } catch { /* already closed */ }
    }
    this.decoder = null;

    const codec = this.codec as VideoCodec;
    for (const mode of availableModes(codec)) {
      const dec = this.makeDecoder(mode);
      if (dec) {
        this.decoder = dec;
        console.log(`[webCodecsDecoder] ${codec}: switched to ${mode}`);
        return;
      }
    }
    // All modes exhausted — this.decoder stays null.
  }

  async init(): Promise<void> {
    await _probesDone;
    const codec = this.codec as VideoCodec;
    for (const mode of availableModes(codec)) {
      const dec = this.makeDecoder(mode);
      if (dec) {
        this.decoder = dec;
        console.log(`[webCodecsDecoder] ${codec}: using ${mode}`);
        return;
      }
    }
    throw new Error(`SmartWebCodecsDecoder: all WebCodecs modes failed for ${codec}`);
  }

  async decode(packet: EncodedPacket): Promise<void> {
    const chunk = new EncodedVideoChunk({
      type: packet.type === 'key' ? 'key' : 'delta',
      timestamp: Math.round(packet.timestamp * 1_000_000),
      duration: Math.round(packet.duration * 1_000_000),
      data: packet.data,
    });
    // Always buffer — needed to replay if mode switching happens in flush().
    this.pendingPackets.push(chunk);

    // Skip the actual decode if the decoder has already closed (error will be
    // handled in flush()).  Try/catch guards against closing between the check
    // and the call.
    if (this.decoder && this.decoder.state === 'configured') {
      try { this.decoder.decode(chunk); } catch { /* decoder closed asynchronously */ }
    }
  }

  async flush(): Promise<void> {
    if (!this.decoder) return;

    /**
     * Attempt to flush the current decoder.
     * Returns true on success, false if the decoder errored or closed.
     */
    const tryFlush = async (): Promise<boolean> => {
      if (!this.decoder || this.decoder.state !== 'configured') return false;
      try {
        await this.decoder.flush();
        return true;
      } catch {
        return false;
      }
    };

    // If the decoder is already in an error/closed state (runtimeError set by
    // the async error callback, or decoder.state already closed), skip straight
    // to retry.  Otherwise attempt the flush and treat failure as an error.
    const ok = this.runtimeError === null
      && this.decoder.state === 'configured'
      && await tryFlush();

    if (ok) {
      this.pendingPackets = [];
      return;
    }

    // The current mode failed.  Switch and replay all buffered packets.
    this.reinitWithNextMode();
    if (!this.decoder) {
      throw new Error(`SmartWebCodecsDecoder: all WebCodecs modes exhausted for ${this.codec}`);
    }

    for (const chunk of this.pendingPackets) {
      if (this.decoder.state !== 'configured') break;
      try { this.decoder.decode(chunk); } catch { break; }
    }

    if (!await tryFlush()) {
      throw new Error(`SmartWebCodecsDecoder: fallback mode also failed for ${this.codec}`);
    }
    this.pendingPackets = [];
  }

  async close(): Promise<void> {
    if (this.decoder && this.decoder.state !== 'closed') {
      try { this.decoder.close(); } catch { /* ignore */ }
    }
    this.decoder = null;
    this.runtimeError = null;
    this.pendingPackets = [];
  }
}

registerDecoder(SmartWebCodecsDecoder);
