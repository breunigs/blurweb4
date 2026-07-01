import type { VideoPlayer } from './videoPlayer';
import type { FileMeta } from './fileMeta';
import { t, tpl } from './i18n';

export interface MediaItem {
  name: string;
  isVideo: boolean;
  file: File;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  player?: VideoPlayer;
  loaded: boolean;
  exported: boolean;
  trimStart?: number;
  trimEnd?: number;
  exportBarFill: HTMLElement;
  exportEtaEl: HTMLElement;
  fileListRow: HTMLElement;
  fileListDurationEl: HTMLElement;
  fileListDimsEl: HTMLElement;
  fileListSizeEl: HTMLElement;
  usesLibav: boolean;
  detectionsDone?: boolean;  // true once applyDetections has been painted on this canvas
  metaPromise: Promise<FileMeta>;
  meta?: FileMeta;
  singleFrame?: boolean;
  toneMappingEnabled: boolean;
}

export interface ItemStore {
  items: MediaItem[];
  activeIndex: number;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return `${m}:${sec}`;
}

export function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return t('almost_done');
  if (s < 60) return tpl('eta_s', { s });
  const m = Math.floor(s / 60),
    r = s % 60;
  return tpl('eta_ms', { m, r: r.toString().padStart(2, '0') });
}

/** Simple debounce — returns a wrapper that fires `fn` only after `ms` ms of silence. */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}
