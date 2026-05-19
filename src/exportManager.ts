import { runBatch } from './batchExporter';
import type { ExportItem } from './batchExporter';
import { getConfig } from './config';
import { t } from './i18n';
import { type ItemStore, formatEta } from './types';

export class ExportManager {
  private exporting = false;

  constructor(
    private readonly store: ItemStore,
    private readonly exportBtn: HTMLButtonElement,
    private readonly exportAllBtn: HTMLButtonElement,
    private readonly globalProgressFill: HTMLElement,
    private readonly globalEta: HTMLElement,
    private readonly exportGlobalRow: HTMLElement,
    private readonly onExportStateChange: (exporting: boolean) => void,
  ) {}

  get isExporting(): boolean {
    return this.exporting;
  }

  markAllDirty(): void {
    for (const it of this.store.items) {
      it.exported = false;
    }
    this.updateBtnState();
  }

  updateBtnState(): void {
    if (this.exporting) return;
    const active = this.store.items[this.store.activeIndex];
    this.exportBtn.disabled = !active || active.exported;
    this.exportAllBtn.disabled = this.store.items.length === 0 || this.store.items.every((it) => it.exported);
  }

  async startExport(forceAll: boolean): Promise<void> {
    if (this.exporting || this.store.items.length === 0) return;
    this.exporting = true;
    this.onExportStateChange(true);
    this.exportBtn.disabled = true;
    this.exportAllBtn.disabled = true;

    if (forceAll) {
      for (const it of this.store.items) {
        it.exported = false;
      }
    }

    const pending = forceAll
      ? this.store.items.filter((it) => !it.exported)
      : [this.store.items[this.store.activeIndex]].filter((it) => it !== undefined && !it.exported);
    if (pending.length === 0) {
      this.exporting = false;
      this.onExportStateChange(false);
      this.updateBtnState();
      return;
    }

    const showGlobal = pending.length > 1;
    if (showGlobal) {
      this.exportGlobalRow.classList.add('visible');
      this.globalProgressFill.style.width = '0%';
      this.globalEta.textContent = t('estimating');
    }

    pending.forEach((it) => it.exportRow.classList.add('active'));

    const exportStart = performance.now();
    let completedCount = 0;
    const total = pending.length;
    const fileStartTimes = new Array<number>(total).fill(0);

    const { keepMetadata, keepAudio, namingPattern } = getConfig();
    const exportItems: ExportItem[] = pending.map((it) => ({
      name: it.name,
      isVideo: it.isVideo,
      canvas: it.isVideo ? undefined : it.canvas,
      file: it.file,
      trimStart: it.trimStart,
      trimEnd: it.trimEnd,
      keepMetadata,
      keepAudio,
      meta: it.meta,
    }));

    const _nav = navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } };
    let wakeLock: { release(): Promise<void> } | null = null;
    if (!_nav.wakeLock) {
      console.log('[wakelock] navigator.wakeLock not available (API unsupported or insecure context)');
    } else {
      try {
        wakeLock = await _nav.wakeLock.request('screen');
        console.log('[wakelock] acquired');
      } catch (err) {
        console.log(`[wakelock] request failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      }
    }
    if (wakeLock === null && navigator.maxTouchPoints > 0 && exportItems.some((it) => it.isVideo)) {
      alert(t('wakelock_warning'));
    }
    try {
      await runBatch(exportItems, namingPattern, {
        onFileStart: (i) => {
          fileStartTimes[i] = performance.now();
          pending[i].exportBarFill.style.width = '0%';
          pending[i].exportEtaEl.textContent = t('estimating');
        },
        onFileProgress: (i, p) => {
          pending[i].exportBarFill.style.width = `${Math.round(p * 100)}%`;
          if (p > 0.01) {
            const elapsed = performance.now() - fileStartTimes[i];
            pending[i].exportEtaEl.textContent = formatEta((elapsed * (1 - p)) / p);
          }
          if (showGlobal) {
            const gp = (completedCount + p) / total;
            this.globalProgressFill.style.width = `${Math.round(gp * 100)}%`;
            const elapsed = performance.now() - exportStart;
            if (gp > 0.01) this.globalEta.textContent = formatEta((elapsed * (1 - gp)) / gp);
          }
        },
        onFileEnd: (i, error) => {
          if (!error) {
            const trimUnchanged =
              pending[i].trimStart === exportItems[i].trimStart && pending[i].trimEnd === exportItems[i].trimEnd;
            if (trimUnchanged) pending[i].exported = true;
            pending[i].exportBarFill.style.width = '100%';
            pending[i].exportEtaEl.textContent = t('done');
          } else {
            pending[i].exportEtaEl.textContent = t('failed');
          }
        },
        onGlobalProgress: (completed) => {
          completedCount = completed;
          if (showGlobal) {
            const p = completed / total;
            this.globalProgressFill.style.width = `${Math.round(p * 100)}%`;
            const elapsed = performance.now() - exportStart;
            this.globalEta.textContent = p >= 1 ? t('done') : formatEta((elapsed * (1 - p)) / p);
          }
        },
      });
    } finally {
      wakeLock?.release().catch((err) => console.warn('[wakelock] release failed:', err));
    }
    this.exporting = false;
    this.onExportStateChange(false);
    this.updateBtnState();

    if (showGlobal) {
      setTimeout(() => {
        this.exportGlobalRow.classList.remove('visible');
        this.globalProgressFill.style.width = '0%';
      }, 3000);
    }
    pending.forEach((it) => setTimeout(() => it.exportRow.classList.remove('active'), 3000));
  }
}
