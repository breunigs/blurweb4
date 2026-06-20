import { encodeVideo } from './videoEncoder';
import { exportAsJpeg } from './imageExporter';
import { applyPattern } from './naming';
import { getConfig } from './config';
import { jpegQualityFor } from './exportUtils';
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
  singleFrame?: boolean;
  toneMappingEnabled?: boolean;
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

export async function runBatch(
  items: ExportItem[],
  namingPattern: string,
  cb: BatchCallbacks,
  isCancelled?: () => boolean,
): Promise<void> {
  const total = items.length;
  let completed = 0;
  const { exportMode } = getConfig();
  const jpegQuality = jpegQualityFor(exportMode);

  for (let i = 0; i < items.length; i++) {
    if (isCancelled?.()) break;
    const item = items[i];
    cb.onFileStart(i);

    const stem = item.name.replace(/\.[^.]+$/, '');
    const outputStem = applyPattern(namingPattern, stem, i + 1, item.meta ?? {});

    try {
      if (!item.isVideo) {
        cb.onFileProgress(i, 1);
        const { blob, filename } = await exportAsJpeg(item.canvas!, item.name, item.file, item.keepMetadata, jpegQuality, outputStem);
        triggerDownload(blob, filename);
      } else if (item.singleFrame && item.canvas) {
        // Single-frame selection → export JPEG from current canvas
        cb.onFileProgress(i, 1);
        const { blob, filename } = await exportAsJpeg(item.canvas, item.name, undefined, item.keepMetadata, jpegQuality, outputStem);
        triggerDownload(blob, filename.replace(/\.[^.]+$/, '.jpg'));
      } else {
        const { buffer, filename } = await encodeVideo(
          item.file!,
          (p) => {
            if (isCancelled?.()) throw new DOMException('Export cancelled', 'AbortError');
            cb.onFileProgress(i, p);
          },
          item.trimStart,
          item.trimEnd,
          item.keepMetadata,
          item.keepAudio,
          outputStem,
          isCancelled,
          item.toneMappingEnabled ?? false,
          exportMode,
        );
        cb.onFileProgress(i, 1);
        triggerDownload(buffer, filename);
      }
      cb.onFileEnd(i);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') break;
      console.error(`Export failed for "${item.name}":`, err);
      cb.onFileEnd(i, err instanceof Error ? err : new Error(String(err)));
    }

    completed++;
    cb.onGlobalProgress(completed, total);
  }
}
