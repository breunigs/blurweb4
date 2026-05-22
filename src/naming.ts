import type { FileMeta } from './fileMeta';
import { getConfig } from './config';

/**
 * Replace {variable} placeholders in pattern.
 * Known variables: input, index, year, month, day, hour, minute, timezone, lat, lon, duration.
 * Unknown or unavailable variables become empty string.
 */
export function applyPattern(
  pattern: string,
  inputStem: string,
  index: number,
  meta: FileMeta,
): string {
  const cfg = getConfig();
  const vars: Record<string, string> = {
    input: inputStem,
    index: String(index),
    year: meta.year ?? '',
    month: meta.month ?? '',
    day: meta.day ?? '',
    hour: meta.hour ?? '',
    minute: meta.minute ?? '',
    timezone: meta.timezone ?? '',
    lat: meta.lat ?? '',
    lon: meta.lon ?? '',
    duration: meta.duration ?? '',
    model: cfg.model === 'detect_x' ? 'large' : 'small',
    redaction_style: cfg.drawMode,
    detect: [...cfg.enabledLabels].sort().join('-'),
    min_confidence: String(cfg.minConfidence),
    area_expansion: String(cfg.expansionFraction),
  };
  return pattern.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}
