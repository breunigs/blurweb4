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
  onmessage = () => { last = performance.now(); };
  setInterval(() => {
    const lag = performance.now() - last;
    if (lag > ${HANG_THRESHOLD_MS})
      postMessage(Math.round(lag));
  }, ${CHECK_INTERVAL_MS});
`;

const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
const worker = new Worker(blobUrl);
URL.revokeObjectURL(blobUrl);

let maxHang = 0;
let pendingLogTimer: ReturnType<typeof setTimeout> | null = null;

worker.onmessage = ({ data }: MessageEvent<number>) => {
  maxHang = Math.max(maxHang, data);
  if (pendingLogTimer === null) {
    pendingLogTimer = setTimeout(() => {
      console.warn(`[hang] main thread blocked for ${maxHang}ms`);
      maxHang = 0;
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
