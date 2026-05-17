import { encodeVideo } from './videoEncoder';
import { exportAsJpeg } from './imageExporter';
import { applyPattern } from './naming';
import type { FileMeta } from './fileMeta';

export interface ExportItem {
  name: string;
  isVideo: boolean;
  canvas?: HTMLCanvasElement;
  file?: File;
  trimStart?: number;
  trimEnd?: number;
  keepMetadata?: 'keep' | 'gps' | 'strip';
  keepAudio?: boolean;
  meta?: FileMeta;
}

export interface BatchCallbacks {
  onFileStart: (index: number) => void;
  onFileProgress: (index: number, progress: number) => void;
  onFileEnd: (index: number, error?: Error) => void;
  onGlobalProgress: (completed: number, total: number) => void;
}

function triggerDownload(data: ArrayBuffer | Blob, filename: string): void {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function runBatch(items: ExportItem[], namingPattern: string, cb: BatchCallbacks): Promise<void> {
  const total = items.length;
  let completed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    cb.onFileStart(i);

    const stem = item.name.replace(/\.[^.]+$/, '');
    const outputStem = applyPattern(namingPattern, stem, i + 1, item.meta ?? {});

    try {
      if (!item.isVideo) {
        cb.onFileProgress(i, 1);
        const { blob, filename } = await exportAsJpeg(item.canvas!, item.name, item.file, item.keepMetadata, 0.92, outputStem);
        triggerDownload(blob, filename);
      } else {
        const { buffer, filename } = await encodeVideo(
          item.file!,
          (p) => cb.onFileProgress(i, p),
          item.trimStart,
          item.trimEnd,
          item.keepMetadata,
          item.keepAudio,
          outputStem,
        );
        cb.onFileProgress(i, 1);
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
