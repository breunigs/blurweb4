/**
 * Main-thread hang detector using a Web Worker heartbeat.
 *
 * The Worker runs independently of the main thread and measures how long the
 * main thread fails to respond to requestAnimationFrame pings.  When the gap
 * exceeds HANG_THRESHOLD_MS the Worker posts a message back, and the main
 * thread logs it via console.warn (captured by the debug log ring buffer).
 */

const HANG_THRESHOLD_MS = 200;
const CHECK_INTERVAL_MS = 50;

const workerSrc = `
  let last = performance.now();
  let lastWall = Date.now();
  let hangReported = false;
  onmessage = () => { last = performance.now(); lastWall = Date.now(); hangReported = false; };
  setInterval(() => {
    const lag = performance.now() - last;
    if (lag > ${HANG_THRESHOLD_MS}) {
      postMessage(hangReported ? Math.round(lag) : { lag: Math.round(lag), startTime: lastWall });
      hangReported = true;
    }
  }, ${CHECK_INTERVAL_MS});
`;

const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
const worker = new Worker(blobUrl);
URL.revokeObjectURL(blobUrl);

type HangMessage = { lag: number; startTime: number } | number;

let maxHang = 0;
let hangStart: Date | null = null;
let pendingLogTimer: ReturnType<typeof setTimeout> | null = null;

// When the window loses focus, browsers (especially on battery) may throttle
// rAF without blocking the Worker, causing false hang reports. Track focus
// state and reset the Worker's baseline on transitions so inactive gaps are
// never counted as hangs.
let windowActive = document.hasFocus();

function onActiveChange(active: boolean): void {
  windowActive = active;
  worker.postMessage(null); // reset Worker's lag baseline
}

window.addEventListener('blur', () => onActiveChange(false));
window.addEventListener('focus', () => onActiveChange(true));
document.addEventListener('visibilitychange', () =>
  onActiveChange(document.visibilityState === 'visible' && document.hasFocus()));

worker.onmessage = ({ data }: MessageEvent<HangMessage>) => {
  if (!windowActive) return;
  if (typeof data === 'object') {
    // First detection: Worker sends { lag, startTime } where startTime is the
    // wall-clock time of the last successful ping — i.e. when the hang began.
    hangStart = new Date(data.startTime);
    maxHang = Math.max(maxHang, data.lag);
  } else {
    maxHang = Math.max(maxHang, data);
  }
  if (pendingLogTimer === null) {
    pendingLogTimer = setTimeout(() => {
      const t = hangStart!;
      const ts = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}.${t.getMilliseconds().toString().padStart(3, '0')}`;
      console.warn(`[hang] ${ts} main thread blocked for ${maxHang}ms`);
      maxHang = 0;
      hangStart = null;
      pendingLogTimer = null;
    }, 0);
  }
};

// rAF stops firing when the main thread is blocked, which is what the worker
// measures. Throttled to ~10/sec to avoid excessive cross-thread messaging.
let lastPing = 0;
function ping(): void {
  const now = performance.now();
  if (now - lastPing >= 100) {
    worker.postMessage(null);
    lastPing = now;
  }
  requestAnimationFrame(ping);
}
requestAnimationFrame(ping);
