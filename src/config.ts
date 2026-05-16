export type DrawMode = 'outline' | 'blackout' | 'blur';
export type ModelChoice = 'detect_n' | 'detect_x';

export interface AppConfig {
  model: ModelChoice;
  drawMode: DrawMode;
}

const STORAGE_KEY = 'blurweb4-config';
const DEFAULTS: AppConfig = { model: 'detect_n', drawMode: 'blur' };

function load(): AppConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: AppConfig = load();

export function getConfig(): AppConfig { return current; }

export function setConfig(patch: Partial<AppConfig>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* ok */ }
  window.dispatchEvent(new CustomEvent('configchange', { detail: current }));
}
