/**
 * Detects the best available video encoder.
 *
 * Preference order: AV1 > HEVC > AVC > VP9.
 * Hardware acceleration is checked first across all codecs; only if nothing
 * works in hardware do we fall back to software.
 */

import { canEncodeVideo } from 'mediabunny';
import type { VideoCodec } from 'mediabunny';

export interface EncoderConfig {
  codec: VideoCodec;
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software';
  /** Container extension including the dot, e.g. '.mp4' */
  ext: '.mp4' | '.webm';
}

const CODEC_PRIORITY: VideoCodec[] = ['av1', 'hevc', 'avc', 'vp9'];

/** VP9 lives in WebM; everything else in MP4. */
function extFor(codec: VideoCodec): '.mp4' | '.webm' {
  return codec === 'vp9' ? '.webm' : '.mp4';
}

/**
 * Returns the best encoder config for the given resolution, or null if the
 * browser cannot encode any supported codec at all.
 *
 * Results are memoised per resolution so repeated calls (e.g. for a batch)
 * hit the cache after the first probe.
 */
const _cache = new Map<string, Promise<EncoderConfig | null>>();

export function detectEncoder(width: number, height: number): Promise<EncoderConfig | null> {
  const key = `${width}x${height}`;
  let p = _cache.get(key);
  if (!p) {
    p = _detect(width, height);
    _cache.set(key, p);
  }
  return p;
}

async function _detect(width: number, height: number): Promise<EncoderConfig | null> {
  const opts = { width, height };
  console.group(`[encoderConfig] probing ${width}×${height}`);

  for (const hw of ['prefer-hardware', 'prefer-software'] as const) {
    for (const codec of CODEC_PRIORITY) {
      const ok = await canEncodeVideo(codec, { ...opts, hardwareAcceleration: hw });
      console.log(`  ${ok ? '✓' : '✗'} ${codec.padEnd(4)} ${hw}`);
      if (ok) {
        const chosen = { codec, hardwareAcceleration: hw, ext: extFor(codec) };
        console.log(`  → chose: ${codec} / ${hw} / ${chosen.ext}`);
        console.groupEnd();
        return chosen;
      }
    }
  }

  console.warn('  → no encodable codec found');
  console.groupEnd();
  return null;
}
