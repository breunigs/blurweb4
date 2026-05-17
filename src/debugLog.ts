/**
 * In-memory debug log ring buffer.
 *
 * Patches console.log/warn/error at module load time so every log statement
 * in the app is automatically captured without needing to thread a logger
 * through every module.  The original console methods are preserved for
 * actual console output.
 */

const MAX_ENTRIES = 1000;
const entries: string[] = [];
let onUpdateCallback: (() => void) | null = null;

function timestamp(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function safeStringify(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    // Cyclic structures, BigInt, etc.
    return String(a);
  }
}

function record(level: string, args: unknown[]): void {
  const msg = args
    .map((a) =>
      typeof a === 'string'
        ? a
        : a instanceof Error
          ? `${a.message}`
          : typeof a === 'object'
            ? safeStringify(a)
            : String(a),
    )
    .join(' ');
  entries.push(`[${timestamp()}] ${level} ${msg}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
  onUpdateCallback?.();
}

// Patch console — preserve original behaviour.
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  origLog(...args);
  record('LOG  ', args);
};
console.warn = (...args: unknown[]) => {
  origWarn(...args);
  record('WARN ', args);
};
console.error = (...args: unknown[]) => {
  origError(...args);
  record('ERROR', args);
};

// Log browser environment at startup.
record('LOG  ', [`userAgent: ${navigator.userAgent}`]);
record('LOG  ', [`platform: ${navigator.platform ?? 'n/a'}`]);
record('LOG  ', [`screen: ${screen.width}×${screen.height} devicePixelRatio=${window.devicePixelRatio}`]);
record('LOG  ', [`language: ${navigator.language}`]);
record('LOG  ', [`hardwareConcurrency: ${navigator.hardwareConcurrency ?? 'n/a'}`]);
record('LOG  ', [`WebCodecs: ${'VideoDecoder' in window ? 'available' : 'unavailable'}`]);
record('LOG  ', [`WebGPU: ${'gpu' in navigator ? 'available' : 'unavailable'}`]);

export function setOnUpdate(cb: () => void): void {
  onUpdateCallback = cb;
}

export function getEntries(): readonly string[] {
  return entries;
}

export function clearEntries(): void {
  entries.length = 0;
}

export function copyToClipboard(): Promise<void> {
  const text = entries.join('\n');
  // Modern Clipboard API — may fail on iOS Safari (permission or context restrictions).
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  }
  return execCommandCopy(text);
}

function execCommandCopy(text: string): Promise<void> {
  // Legacy fallback via execCommand — works on iOS Safari.
  // setSelectionRange(0, 999999) is required for iOS to select the full content.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  ta.readOnly = true;
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 999_999);
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

// Also expose for programmatic access.
(window as unknown as Record<string, unknown>).__debugLog = { getEntries, copyToClipboard };
