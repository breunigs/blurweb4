export type DrawMode = 'outline' | 'blackout' | 'blur' | 'pixelate';
export type ModelChoice = 'detect_n' | 'detect_x';
export type MetadataMode = 'keep' | 'gps' | 'strip';

export interface AppConfig {
  model: ModelChoice;
  drawMode: DrawMode;
  keepMetadata: MetadataMode;
  keepAudio: boolean;
  minConfidence: number;
  namingPattern: string;
}

const STORAGE_KEY = 'blurweb4-config';
export const DEFAULTS: AppConfig = {
  model: 'detect_n',
  drawMode: 'blur',
  keepMetadata: 'keep',
  keepAudio: true,
  minConfidence: 0.05,
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

export function getConfig(): AppConfig {
  return current;
}

export function setConfig(patch: Partial<AppConfig>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ok */
  }
  window.dispatchEvent(new CustomEvent('configchange', { detail: current }));
}
