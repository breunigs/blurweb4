/**
 * Quality-mode WebCodecs encoder for AV1.
 *
 * mediabunny hardcodes latencyMode:'realtime' for all WebCodecs encodes.
 * For AV1 this is particularly damaging — libaom in realtime mode uses
 * speed=10 (the fastest / lowest quality preset), producing blocky output
 * even at high bitrates.
 *
 * This CustomVideoEncoder subclass uses latencyMode:'quality' for AV1.
 *
 * To avoid false positives (isConfigSupported() can lie, as does the
 * hardware AV1 decoder in some environments), we perform a real encode
 * probe at module load. The encoder only registers itself if the probe
 * succeeds; otherwise mediabunny's built-in encoder takes over as normal.
 */

import { CustomVideoEncoder, EncodedPacket, registerEncoder } from 'mediabunny';
import type { VideoSample } from 'mediabunny';

// ── Startup probe ─────────────────────────────────────────────────────────────
// Probe whether quality-mode AV1 encoding actually works (not just
// isConfigSupported, which can return true even when configure() fails).
// Uses a tiny 2×2 frame encode as the cheapest possible real test.

const PROBE_W = 2,
  PROBE_H = 2;

async function probeQualityAv1(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;

  const config: VideoEncoderConfig = {
    codec: 'av01.0.00M.08',
    width: PROBE_W,
    height: PROBE_H,
    bitrate: 100_000,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-software', // SW encoder supports quality mode
  };

  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    console.log('[qualityEncoder] quality-mode AV1 not supported (isConfigSupported=false)');
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let ok = false;
    const enc = new VideoEncoder({
      output: () => {
        ok = true;
      },
      error: () => {
        resolve(false);
      },
    });
    try {
      enc.configure(config);
      const frameData = new Uint8Array(PROBE_W * PROBE_H * 4);
      const frame = new VideoFrame(frameData, {
        format: 'RGBA',
        codedWidth: PROBE_W,
        codedHeight: PROBE_H,
        timestamp: 0,
      });
      enc.encode(frame);
      frame.close();
      enc
        .flush()
        .then(() => {
          enc.close();
          console.log(`[qualityEncoder] quality-mode AV1 probe: ${ok ? 'ok' : 'no output'}`);
          resolve(ok);
        })
        .catch((err) => {
          console.warn('[qualityEncoder] AV1 probe flush failed:', err);
          resolve(false);
        });
    } catch (err) {
      console.warn('[qualityEncoder] AV1 probe configure failed:', err);
      enc.close();
      resolve(false);
    }
  });
}

let qualityAv1Ready = false;
const probePromise = probeQualityAv1().then((ok) => {
  qualityAv1Ready = ok;
  if (!ok) console.log('[qualityEncoder] quality-mode AV1 unavailable — not registering');
});

// ── Encoder ───────────────────────────────────────────────────────────────────

export class QualityModeAv1Encoder extends CustomVideoEncoder {
  private encoder: VideoEncoder | null = null;
  private encodeError: Error | null = null;

  static override supports(codec: string, _config: VideoEncoderConfig): boolean {
    // Only claim AV1 if our startup probe confirmed quality mode works.
    return codec === 'av1' && qualityAv1Ready;
  }

  async init(): Promise<void> {
    // Wait for probe in case init() is called very soon after module load.
    await probePromise;
    if (!qualityAv1Ready) {
      throw new Error('[qualityEncoder] quality-mode AV1 not available');
    }

    const config: VideoEncoderConfig = {
      ...this.config,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-software', // quality mode works reliably in SW
    };

    this.encodeError = null;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const packet = new EncodedPacket(
          data,
          chunk.type === 'key' ? 'key' : 'delta',
          chunk.timestamp / 1_000_000, // µs → s
          (chunk.duration ?? 0) / 1_000_000,
        );
        this.onPacket(packet, meta);
      },
      error: (e) => {
        this.encodeError = e instanceof Error ? e : new Error(String(e));
        console.error('[qualityEncoder] VideoEncoder error:', e);
      },
    });

    this.encoder.configure(config);
    if (this.encoder.state !== 'configured') {
      throw new Error(`[qualityEncoder] configure failed (state=${this.encoder.state})`);
    }
    console.log('[qualityEncoder] AV1 encoder ready (latencyMode:quality, prefer-software)');
  }

  encode(sample: VideoSample, options: VideoEncoderEncodeOptions): void {
    if (this.encodeError) throw this.encodeError;
    if (!this.encoder || this.encoder.state !== 'configured') {
      throw new Error('[qualityEncoder] encoder not configured');
    }
    const frame = sample.toVideoFrame();
    try {
      this.encoder.encode(frame, options);
    } finally {
      frame.close();
    }
  }

  async flush(): Promise<void> {
    if (this.encodeError) throw this.encodeError;
    if (!this.encoder || this.encoder.state !== 'configured') {
      throw new Error('[qualityEncoder] encoder not configured at flush');
    }
    await this.encoder.flush();
    if (this.encodeError) throw this.encodeError;
  }

  async close(): Promise<void> {
    if (!this.encoder) return;
    if (this.encoder.state !== 'closed') this.encoder.close();
    this.encoder = null;
  }
}

registerEncoder(QualityModeAv1Encoder);
