import { runBatch } from './batchExporter';
import type { ExportItem } from './batchExporter';
import { getConfig } from './config';
import { getAverageInferenceMs } from './detector';
import { t, tpl } from './i18n';
import { type ItemStore, formatEta } from './types';

// Assumed frame rate for pre-encoding ETA estimation when no timing data yet.
const FPS_ESTIMATE = 30;

// In Tauri, window.alert() is silently suppressed. Use the dialog plugin instead;
// fall back to window.alert in the plain browser.
async function tauriAlert(message: string): Promise<void> {
  if ('__TAURI_INTERNALS__' in window) {
    const { message: tauriMessage } = await import('@tauri-apps/plugin-dialog');
    await tauriMessage(message);
  } else {
    alert(message);
  }
}

export class ExportManager {
  private exporting = false;
  private cancelled = false;
  private readonly cancelBtn: HTMLButtonElement;

  constructor(
    private readonly store: ItemStore,
    private readonly exportBtn: HTMLButtonElement,
    private readonly exportAllBtn: HTMLButtonElement,
    private readonly globalProgressFill: HTMLElement,
    private readonly globalEta: HTMLElement,
    private readonly exportGlobalRow: HTMLElement,
    private readonly onExportStateChange: (exporting: boolean) => void,
  ) {
    this.cancelBtn = document.getElementById('cancel-export-btn') as HTMLButtonElement;
    this.cancelBtn.addEventListener('click', () => { this.cancelled = true; });
  }

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
    this.updateBtnLabels();
  }

  updateBtnLabels(): void {
    const active = this.store.items[this.store.activeIndex];
    this.exportBtn.textContent = tpl('btn_export', { name: active?.name ?? '' });
    this.exportAllBtn.textContent = tpl('btn_export_all', { n: this.store.items.length });
  }

  async startExport(forceAll: boolean): Promise<void> {
    if (this.exporting || this.store.items.length === 0) return;
    this.exporting = true;
    this.cancelled = false;
    this.onExportStateChange(true);
    this.exportBtn.disabled = true;
    this.exportAllBtn.disabled = true;
    this.cancelBtn.hidden = false;
    this.exportGlobalRow.classList.add('visible');
    this.globalProgressFill.style.width = '0%';
    this.globalEta.textContent = t('estimating');

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
      this.cancelBtn.hidden = true;
      this.onExportStateChange(false);
      this.updateBtnState();
      return;
    }

    const showGlobal = pending.length > 1;

    document.getElementById('step-load')!.classList.add('has-eta');
    pending.forEach((it) => it.fileListRow.classList.add('exporting'));

    const exportStart = performance.now();
    let completedCount = 0;
    const total = pending.length;
    const fileStartTimes = new Array<number>(total).fill(0);

    // Pre-compute estimated encoding time per file using average inference stats.
    // Used to show a meaningful ETA before enough elapsed data has accumulated.
    const avgInferenceMs = getAverageInferenceMs();
    const fileEstimatedMs = pending.map((it) => {
      if (!it.isVideo || it.singleFrame || avgInferenceMs === null) return 0;
      const fullDuration = it.player?.duration ?? 0;
      const trimmedDuration = (it.trimEnd ?? fullDuration) - (it.trimStart ?? 0);
      return trimmedDuration > 0 ? trimmedDuration * FPS_ESTIMATE * avgInferenceMs : 0;
    });

    const { keepMetadata, keepAudio, namingPattern } = getConfig();
    const exportItems: ExportItem[] = pending.map((it) => ({
      name: it.name,
      isVideo: it.isVideo,
      canvas: it.canvas,
      file: it.file,
      trimStart: it.trimStart,
      trimEnd: it.trimEnd,
      keepMetadata,
      keepAudio,
      meta: it.meta,
      singleFrame: it.singleFrame,
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
      tauriAlert(t('wakelock_warning'));
    }
    try {
      await runBatch(exportItems, namingPattern, {
        onFileStart: (i) => {
          fileStartTimes[i] = performance.now();
          pending[i].exportBarFill.style.width = '0%';
          pending[i].exportEtaEl.textContent = '';
          pending[i].exportEtaEl.classList.remove('done', 'error');
        },
        onFileProgress: (i, p) => {
          pending[i].exportBarFill.style.width = `${Math.round(p * 100)}%`;
          const fileElapsed = performance.now() - fileStartTimes[i];
          const est = fileEstimatedMs[i];

          // Per-file ETA: elapsed-based extrapolation once enough data (p > 1%),
          // inference-stats estimate before that so the ETA is non-blank from the start.
          const fileRemaining = p > 0.01
            ? (fileElapsed * (1 - p)) / p
            : est > 0 ? est * (1 - p) : null;
          if (fileRemaining !== null) {
            pending[i].exportEtaEl.textContent = formatEta(fileRemaining);
          }

          const gp = showGlobal ? (completedCount + p) / total : p;
          this.globalProgressFill.style.width = `${Math.round(gp * 100)}%`;
          const globalElapsed = performance.now() - exportStart;

          // Global remaining = current file remaining + sum of estimates for unstarted files.
          // For unstarted files without an inference-stats estimate, fall back to the
          // running average time per file (elapsed ÷ files-equivalent completed so far).
          const curFileRemaining = fileRemaining ?? (est > 0 ? est : null);
          if (curFileRemaining !== null) {
            let globalRemaining = curFileRemaining;
            if (showGlobal) {
              const avgMsPerFile = completedCount + p > 0.01
                ? globalElapsed / (completedCount + p)
                : est > 0 ? est : 0;
              for (let j = completedCount + 1; j < total; j++) {
                globalRemaining += fileEstimatedMs[j] > 0 ? fileEstimatedMs[j] : avgMsPerFile;
              }
            }
            this.globalEta.textContent = formatEta(globalRemaining);
          } else if (gp > 0.01) {
            this.globalEta.textContent = formatEta((globalElapsed * (1 - gp)) / gp);
          }
        },
        onFileEnd: (i, error) => {
          if (!error) {
            const trimUnchanged =
              pending[i].trimStart === exportItems[i].trimStart && pending[i].trimEnd === exportItems[i].trimEnd;
            if (trimUnchanged) pending[i].exported = true;
            pending[i].exportBarFill.style.width = '100%';
            pending[i].exportEtaEl.textContent = '✓';
            pending[i].exportEtaEl.classList.add('done');
          } else {
            pending[i].exportEtaEl.textContent = t('failed');
            pending[i].exportEtaEl.classList.add('error');
          }
        },
        onGlobalProgress: (completed) => {
          completedCount = completed;
          const p = showGlobal ? completed / total : 1;
          this.globalProgressFill.style.width = `${Math.round(p * 100)}%`;
          const elapsed = performance.now() - exportStart;
          this.globalEta.textContent = p >= 1 ? t('done') : formatEta((elapsed * (1 - p)) / p);
        },
      }, () => this.cancelled);
    } finally {
      wakeLock?.release().catch((err) => console.warn('[wakelock] release failed:', err));
    }
    this.exporting = false;
    this.cancelBtn.hidden = true;
    this.onExportStateChange(false);
    this.updateBtnState();

    const delay = this.cancelled ? 0 : 3000;
    if (this.cancelled) {
      this.globalEta.textContent = t('cancelled');
      this.globalProgressFill.style.width = '0%';
    }
    setTimeout(() => {
      this.exportGlobalRow.classList.remove('visible');
      this.globalProgressFill.style.width = '0%';
      this.globalEta.textContent = '';
    }, delay);
    pending.forEach((it) => setTimeout(() => {
      it.fileListRow.classList.remove('exporting');
      it.exportBarFill.style.width = '';
      if (!it.exportEtaEl.classList.contains('done')) {
        it.exportEtaEl.textContent = '';
        it.exportEtaEl.classList.remove('error');
      }
    }, delay));
  }
}
