/**
 * Forward a worker's console output to the main thread.
 *
 * `debugLog` patches `console` on the main thread only, so anything a worker
 * logs is invisible in the in-app debug panel — which is the only log available
 * on a phone. Diagnosing an OCR failure on iOS meant the decisive lines (the
 * deskew angle and the text-region scores) could not be seen at all.
 *
 * The worker keeps writing to its own console as well, so DevTools is
 * unaffected; the main thread re-logs the forwarded lines so `debugLog`
 * captures them like any other output.
 */

export const WORKER_LOG_MSG = 'worker-log';

export interface WorkerLogMessage {
  type: typeof WORKER_LOG_MSG;
  level: 'log' | 'warn' | 'error';
  text: string;
}

/** Stringify one console argument without throwing on cycles or BigInt. */
function format(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  if (typeof a !== 'object' || a === null) return String(a);
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Minimal shape of the worker global; the DOM lib types are not loaded here. */
interface PostMessageScope {
  postMessage(message: unknown): void;
}

/**
 * Patch `console` inside a worker so every line is also posted to the main
 * thread. Call once at worker start-up.
 */
export function forwardWorkerLogs(scope: PostMessageScope = self as unknown as PostMessageScope): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        scope.postMessage({
          type: WORKER_LOG_MSG,
          level,
          text: args.map(format).join(' '),
        } satisfies WorkerLogMessage);
      } catch {
        // A non-cloneable argument must never break the actual logging.
      }
    };
  }
}

/**
 * Handle a message posted by `forwardWorkerLogs`. Returns true when the message
 * was a forwarded log line and needs no further routing.
 */
export function handleWorkerLogMessage(msg: { type?: unknown; level?: unknown; text?: unknown }, label: string): boolean {
  if (msg?.type !== WORKER_LOG_MSG) return false;
  const level = msg.level === 'warn' || msg.level === 'error' ? msg.level : 'log';
  // Re-logged on the main thread so debugLog's ring buffer picks it up.
  console[level](`[${label}] ${String(msg.text ?? '')}`);
  return true;
}
