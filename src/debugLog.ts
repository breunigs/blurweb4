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
  const h = d.getHours().toString().padStart(2,'0');
  const m = d.getMinutes().toString().padStart(2,'0');
  const s = d.getSeconds().toString().padStart(2,'0');
  const ms = d.getMilliseconds().toString().padStart(3,'0');
  return `${h}:${m}:${s}.${ms}`;
}

function record(level: string, args: unknown[]): void {
  const msg = args.map(a =>
    typeof a === 'string' ? a :
    a instanceof Error    ? `${a.message}` :
    typeof a === 'object' ? JSON.stringify(a) :
    String(a)
  ).join(' ');
  entries.push(`[${timestamp()}] ${level} ${msg}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
  onUpdateCallback?.();
}

// Patch console — preserve original behaviour.
const origLog   = console.log.bind(console);
const origWarn  = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args: unknown[])   => { origLog(...args);   record('LOG  ', args); };
console.warn = (...args: unknown[])  => { origWarn(...args);  record('WARN ', args); };
console.error = (...args: unknown[]) => { origError(...args); record('ERROR', args); };

export function setOnUpdate(cb: () => void): void {
  onUpdateCallback = cb;
}

export function getEntries(): readonly string[] { return entries; }

export function clearEntries(): void { entries.length = 0; }

export function copyToClipboard(): Promise<void> {
  return navigator.clipboard.writeText(entries.join('\n'));
}

// Also expose for programmatic access.
(window as unknown as Record<string, unknown>).__debugLog = { getEntries, copyToClipboard };

