import { encodeVideo } from './videoEncoder';
import { exportAsJpeg } from './imageExporter';

export interface ExportItem {
  name: string;
  isVideo: boolean;
  canvas?: HTMLCanvasElement;
  file?: File;
  trimStart?: number;
  trimEnd?: number;
  keepMetadata?: 'keep' | 'gps' | 'strip';
  keepAudio?: boolean;
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

export async function runBatch(items: ExportItem[], cb: BatchCallbacks): Promise<void> {
  const total = items.length;
  let completed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    cb.onFileStart(i);

    try {
      if (!item.isVideo) {
        cb.onFileProgress(i, 1);
        const { blob, filename } = await exportAsJpeg(item.canvas!, item.name, item.file, item.keepMetadata);
        triggerDownload(blob, filename);
      } else {
        const { buffer, filename } = await encodeVideo(
          item.file!,
          (p) => cb.onFileProgress(i, p),
          item.trimStart,
          item.trimEnd,
          item.keepMetadata,
          item.keepAudio,
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
