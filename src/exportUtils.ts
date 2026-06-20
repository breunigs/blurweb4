import type { ExportMode } from './config';

/** JPEG quality for canvas.toBlob() per export mode. */
export function jpegQualityFor(mode: ExportMode): number {
  return mode === 'filesize' ? 0.65 : 0.95;
}

/**
 * Effective video bitrate per export mode.
 * Filesize mode halves the source bitrate; quality mode keeps it as-is.
 * Returns null when sourceBitrate is null (let the encoder decide).
 */
export function effectiveBitrateFor(mode: ExportMode, sourceBitrate: number | null): number | null {
  if (sourceBitrate === null) return null;
  return mode === 'filesize' ? Math.round(sourceBitrate * 0.5) : sourceBitrate;
}
