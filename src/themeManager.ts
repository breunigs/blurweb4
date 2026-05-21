export type ThemePlatform = 'auto' | 'macos' | 'windows';
export type ThemeColor = 'auto' | 'light' | 'dark';
type EffectivePlatform = 'macos' | 'windows';
type EffectiveColor = 'light' | 'dark';

const PLATFORM_KEY = 'blurweb4-theme-platform';
const COLOR_KEY = 'blurweb4-theme-color';

function detectPlatform(): EffectivePlatform {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  return 'macos';
}

function getSystemColor(): EffectiveColor {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(): void {
  const stored = localStorage.getItem(PLATFORM_KEY) as ThemePlatform | null;
  // Treat legacy 'web' value (or anything unrecognised) as 'auto'
  const platformPref: ThemePlatform =
    stored === 'macos' || stored === 'windows' ? stored : 'auto';
  const colorPref = (localStorage.getItem(COLOR_KEY) as ThemeColor) || 'auto';
  const platform: EffectivePlatform =
    platformPref === 'auto' ? detectPlatform() : platformPref;
  const color: EffectiveColor =
    colorPref === 'auto' ? getSystemColor() : (colorPref as EffectiveColor);
  document.documentElement.dataset.theme = `${platform}-${color}`;
}

export function getPlatformPref(): ThemePlatform {
  const stored = localStorage.getItem(PLATFORM_KEY) as ThemePlatform | null;
  return stored === 'macos' || stored === 'windows' ? stored : 'auto';
}

export function getColorPref(): ThemeColor {
  return (localStorage.getItem(COLOR_KEY) as ThemeColor) || 'auto';
}

export function getAutoDetectedPlatform(): EffectivePlatform {
  return detectPlatform();
}

export function setPlatformPref(platform: ThemePlatform): void {
  localStorage.setItem(PLATFORM_KEY, platform);
  applyTheme();
}

export function setColorPref(color: ThemeColor): void {
  localStorage.setItem(COLOR_KEY, color);
  applyTheme();
}

export function initTheme(): void {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getColorPref() === 'auto') applyTheme();
  });
}

export function initThemeControls(): void {
  const platformInputs = document.querySelectorAll<HTMLInputElement>(
    'input[name="theme-platform"]',
  );
  const colorInputs = document.querySelectorAll<HTMLInputElement>('input[name="theme-color"]');

  const currentPlatform = getPlatformPref();
  const currentColor = getColorPref();

  platformInputs.forEach(input => {
    if (input.value === currentPlatform) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) setPlatformPref(input.value as ThemePlatform);
    });
  });

  colorInputs.forEach(input => {
    if (input.value === currentColor) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) setColorPref(input.value as ThemeColor);
    });
  });
}
