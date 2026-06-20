export type DrawMode = 'outline' | 'solidcolor' | 'blur' | 'pixelate';
export type ModelChoice = 'detect_n' | 'detect_x';
export type MetadataMode = 'keep' | 'gps' | 'strip';
export type ExportMode = 'quality' | 'filesize';

export interface AppConfig {
  model: ModelChoice;
  drawMode: DrawMode;
  solidColor: string;
  keepMetadata: MetadataMode;
  keepAudio: boolean;
  exportMode: ExportMode;
  minConfidence: number;
  /** Fraction [0, 1] by which to expand each detection box on all sides. */
  expansionFraction: number;
  /** Which detection labels to redact. */
  enabledLabels: string[];
  namingPattern: string;
}

const STORAGE_KEY = 'blurweb4-config';
export const DEFAULTS: AppConfig = {
  model: 'detect_n',
  drawMode: 'blur',
  solidColor: '#000000',
  keepMetadata: 'keep',
  keepAudio: true,
  exportMode: 'quality',
  minConfidence: 0.05,
  expansionFraction: 0,
  enabledLabels: ['plate', 'person'],
  namingPattern: '{input}',
};

function load(): AppConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // Migrate old boolean keepMetadata from pre-GPS-option versions
    if (typeof stored.keepMetadata === 'boolean') {
      stored.keepMetadata = stored.keepMetadata ? 'keep' : 'strip';
    }
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: AppConfig = load();

/** True on phones (not tablets): mobile UA + small screen (< 768 px on short axis). */
function isMobilePhone(): boolean {
  const ua = navigator.userAgent;
  const mobileUA = /Android|iPhone|iPod|Windows Phone/i.test(ua);
  const smallScreen = Math.min(screen.width, screen.height) < 768;
  return mobileUA && smallScreen;
}

export function getConfig(): AppConfig {
  return current;
}

/**
 * Whether the large model (detect_x) has proven to work in this session.
 * On iOS, large models crash the tab with OOM before inference completes.
 * We avoid persisting detect_x until we know it can actually run inference.
 * On mobile phones we never persist detect_x — if the tab crashes (OOM) the
 * page reload falls back to detect_n from localStorage.
 */
let largeModelConfirmed = false;

/** Call after the first successful inference when detect_x is active. */
export function confirmLargeModelOk(): void {
  if (current.model === 'detect_x' && !largeModelConfirmed) {
    largeModelConfirmed = true;
    if (isMobilePhone()) return; // never persist large model on mobile
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch { /* ok */ }
  }
}

export function setConfig(patch: Partial<AppConfig>): void {
  current = { ...current, ...patch };
  try {
    // Don't persist detect_x until we've confirmed it works (iOS OOM guard).
    const toSave: AppConfig =
      current.model === 'detect_x' && !largeModelConfirmed
        ? { ...current, model: 'detect_n' }
        : current;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    /* ok */
  }
  window.dispatchEvent(new CustomEvent('configchange', { detail: { config: current, changedKeys: Object.keys(patch) as (keyof AppConfig)[] } }));
}
