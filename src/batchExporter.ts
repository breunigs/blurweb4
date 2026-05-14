import { encodeVideo } from './videoEncoder';
import { exportAsJpeg } from './imageExporter';

export interface ExportItem {
  name: string;
  isVideo: boolean;
  /** For images: the canvas already holding the decoded pixels. */
  canvas?: HTMLCanvasElement;
  /** For videos: the original File object (re-read for encoding). */
  file?: File;
  /** Element whose style.width we update during video encoding (0–100%). */
  progressFill: HTMLElement | null;
  /** Wrapper element to show/hide the progress bar track. */
  progressTrack: HTMLElement | null;
}

export interface BatchCallbacks {
  /** Called when any file starts processing (0-based index). */
  onFileStart: (index: number) => void;
  /** Called when a file finishes (successfully or not). */
  onFileEnd: (index: number, error?: Error) => void;
  /** Called after each completed file with overall count. Images complete instantly. */
  onGlobalProgress: (completed: number, total: number) => void;
}

function triggerDownload(data: ArrayBuffer | Blob, filename: string): void {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function runBatch(items: ExportItem[], cb: BatchCallbacks): Promise<void> {
  const total = items.length;
  let completed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    cb.onFileStart(i);

    try {
      if (!item.isVideo) {
        // ── Image: encode as JPEG (fast, no progress bar) ──────────────
        const { blob, filename } = await exportAsJpeg(item.canvas!, item.name);
        triggerDownload(blob, filename);
      } else {
        // ── Video: re-encode ────────────────────────────────────────────
        if (item.progressTrack) item.progressTrack.hidden = false;

        const { buffer, filename } = await encodeVideo(item.file!, (p) => {
          if (item.progressFill) item.progressFill.style.width = `${Math.round(p * 100)}%`;
        });

        if (item.progressFill) item.progressFill.style.width = '100%';
        triggerDownload(buffer, filename);
      }

      cb.onFileEnd(i);
    } catch (err) {
      console.error(`Export failed for "${item.name}":`, err);
      cb.onFileEnd(i, err instanceof Error ? err : new Error(String(err)));
    }

    completed++;
    cb.onGlobalProgress(completed, total);
  }
}
