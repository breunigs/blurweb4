import {
  getCachedDetections,
  scheduleInference,
  makeImageKey,
  getAverageInferenceMs,
  setModel,
  clearDetectionCache,
  applyFilters,
} from './detector';
import { applyDetections } from './detectionDrawer';
import { getConfig, setConfig, confirmLargeModelOk, DEFAULTS, type AppConfig, type ModelChoice } from './config';
import { t, tpl, applyTranslations } from './i18n';
import { getEntries, clearEntries, setOnUpdate, copyToClipboard } from './debugLog';
import { renderImage } from './imageRenderer';
import { type ItemStore, debounce } from './types';

// In Tauri, window.confirm() is silently suppressed. Use the dialog plugin instead;
// fall back to window.confirm in the plain browser.
async function tauriConfirm(message: string): Promise<boolean> {
  if ('__TAURI_INTERNALS__' in window) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return ask(message);
  }
  return confirm(message);
}
import { ExportManager } from './exportManager';
import { PlaybackController } from './playbackController';
import { FileManager } from './fileManager';

export class App {
  private store: ItemStore = { items: [], activeIndex: -1 };
  private prevModel: ModelChoice = getConfig().model;
  private exportManager!: ExportManager;
  private playback!: PlaybackController;
  private files!: FileManager;

  // DOM refs (kept for inference UI and model loading, which stay in App)
  private previewArea!: HTMLElement;
  private exportBtn!: HTMLButtonElement;
  private exportAllBtn!: HTMLButtonElement;
  private globalProgressFill!: HTMLElement;
  private globalEta!: HTMLElement;
  private exportGlobalRow!: HTMLElement;
  private modelLoadProgress!: HTMLElement;
  private modelLoadBarFill!: HTMLElement;
  private detectStatusInline!: HTMLElement;
  private libavWarningEl!: HTMLElement;
  private loadedSummary!: HTMLElement;
  private stepPreviewSubtitle!: HTMLElement;
  private audioSettingRow!: HTMLElement;
  private modelLoadAfterSwitch = false;

  init(): void {
    this.previewArea = document.getElementById('preview-area')!;
    this.exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
    this.exportAllBtn = document.getElementById('export-all-btn') as HTMLButtonElement;
    this.globalProgressFill = document.getElementById('global-progress-fill')!;
    this.globalEta = document.getElementById('global-eta')!;
    this.exportGlobalRow = document.getElementById('export-global-row')!;
    this.modelLoadProgress = document.getElementById('model-load-progress')!;
    this.modelLoadBarFill = document.getElementById('model-load-bar-fill')!;
    this.detectStatusInline = document.getElementById('detect-status-inline')!;
    this.libavWarningEl = document.getElementById('libav-warning')!;
    this.loadedSummary = document.getElementById('loaded-summary')!;
    this.stepPreviewSubtitle = document.getElementById('step-preview-subtitle')!;
    this.audioSettingRow = document.getElementById('audio-setting-row')!;

    this.exportManager = new ExportManager(
      this.store,
      this.exportBtn,
      this.exportAllBtn,
      this.globalProgressFill,
      this.globalEta,
      this.exportGlobalRow,
      (_exporting) => { /* exporting state owned by ExportManager */ },
    );
    this.exportManager.updateBtnLabels();

    this.playback = new PlaybackController(
      this.store,
      this.previewArea,
      document.getElementById('trim-section')!,
      document.getElementById('scrubber') as HTMLInputElement,
      document.getElementById('trim-start-text') as HTMLInputElement,
      document.getElementById('trim-end-text') as HTMLInputElement,
      document.getElementById('trim-start-now') as HTMLButtonElement,
      document.getElementById('trim-end-now') as HTMLButtonElement,
      document.getElementById('trim-whole-video') as HTMLButtonElement,
      document.getElementById('trim-duration-label')!,
      (_item) => {
        // Trim changed: refresh export button state.
        this.exportManager.updateBtnState();
      },
    );

    this.files = new FileManager(
      this.store,
      this.previewArea,
      this.loadedSummary,
      this.stepPreviewSubtitle,
      this.audioSettingRow,
      this.libavWarningEl,
      this.detectStatusInline,
      this.exportAllBtn,
      this.playback,
      this.exportManager,
      (on) => this.showDetecting(on),
      (dets) => this.showDetectionResult(dets),
      (err) => this.showInferenceError(err),
      () => this.rerenderActive(),
      (index) => {
        this.detectStatusInline.classList.remove('visible');
        void this.updateNamingInfoPanel();
        void index;
      },
    );

    applyTranslations();
    this.bindEvents();
    this.syncConfigUI();
    this.initDebugLog();
    this.bindDebugLogButtons();

    // Test globals
    const w = window as unknown as Record<string, unknown>;
    w.__setDrawMode = (m: string) => setConfig({ drawMode: m as AppConfig['drawMode'] });
    w.__setMinConfidence = (v: number) => {
      w.__lastDetections = undefined;
      setConfig({ minConfidence: v });
    };
    w.__setTrimStart = (t: number) => {
      const item = this.store.items[this.store.activeIndex];
      if (item?.isVideo) this.playback.applyTrimStart(item, t);
    };
    // Sets trim without re-seeking (avoids triggering new inference for the test).
    w.__setTrimStartSilent = (t: number) => {
      const item = this.store.items[this.store.activeIndex];
      if (item?.isVideo) {
        item.trimStart = t;
      }
    };
    w.__getActiveTrimValues = () => {
      const item = this.store.items[this.store.activeIndex];
      return item?.isVideo ? { start: item.trimStart ?? 0, end: item.trimEnd ?? item.player?.duration ?? 0 } : null;
    };
    w.__setTrimEnd = (t: number) => {
      const item = this.store.items[this.store.activeIndex];
      if (item?.isVideo && item.player) {
        item.exported = false;
        this.exportManager.updateBtnState();
        this.playback.applyTrimEnd(item, t);
      }
    };
    // Sets trim end without re-seeking (for tests that don't need the preview frame).
    w.__setTrimEndSilent = (t: number) => {
      const item = this.store.items[this.store.activeIndex];
      if (item?.isVideo && item.player) {
        item.trimEnd = t;
        item.exported = false;
        this.exportManager.updateBtnState();
        this.playback.updateTrimLabels(item);
      }
    };
  }

  private syncConfigUI(): void {
    const cfg = getConfig();
    const mr = document.querySelector<HTMLInputElement>(`input[name="model"][value="${cfg.model}"]`);
    if (mr) mr.checked = true;
    const dr = document.querySelector<HTMLInputElement>(`input[name="drawMode"][value="${cfg.drawMode}"]`);
    if (dr) dr.checked = true;
    const meta = document.querySelector<HTMLInputElement>(
      `input[name="keepMetadata"][value="${cfg.keepMetadata}"]`,
    );
    if (meta) meta.checked = true;
    const audio = document.querySelector<HTMLInputElement>(
      `input[name="keepAudio"][value="${cfg.keepAudio ? 'keep' : 'strip'}"]`,
    );
    if (audio) audio.checked = true;
    const slider = document.getElementById('conf-slider') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(Math.round(cfg.minConfidence * 100));
      (document.getElementById('conf-value') as HTMLElement).textContent = `${Math.round(cfg.minConfidence * 100)}%`;
    }
    const expSlider = document.getElementById('expansion-slider') as HTMLInputElement | null;
    if (expSlider) {
      expSlider.value = String(Math.round(cfg.expansionFraction * 100));
      (document.getElementById('expansion-value') as HTMLElement).textContent = `${Math.round(cfg.expansionFraction * 100)}%`;
    }
    const labelsRadioVal =
      cfg.enabledLabels.includes('plate') && cfg.enabledLabels.includes('person') ? 'both'
      : cfg.enabledLabels.includes('plate') ? 'plate'
      : 'person';
    const lr = document.querySelector<HTMLInputElement>(`input[name="enabledLabels"][value="${labelsRadioVal}"]`);
    if (lr) lr.checked = true;
    const ni = document.getElementById('naming-pattern-input') as HTMLInputElement | null;
    if (ni) ni.value = cfg.namingPattern;
    const cp = document.getElementById('solidcolor-color-picker') as HTMLInputElement | null;
    if (cp) cp.value = cfg.solidColor;
    const bl = document.getElementById('solidcolor-label') as HTMLElement | null;
    if (bl) bl.style.setProperty('--solidcolor-swatch', cfg.solidColor);
  }

  private async updateNamingInfoPanel(): Promise<void> {
    const panel = document.getElementById('naming-info-panel');
    if (!panel || panel.hidden) return;
    const item = this.store.items[this.store.activeIndex];
    const stem = item ? item.name.replace(/\.[^.]+$/, '') : '';
    const meta = item ? (item.meta ?? await item.metaPromise) : {};
    const cfg = getConfig();
    const values: Record<string, string> = {
      input: stem,
      index: '1',
      model: cfg.model === 'detect_x' ? 'large' : 'small',
      redaction_style: cfg.drawMode,
      detect: [...cfg.enabledLabels].sort().join('-'),
      min_confidence: String(cfg.minConfidence),
      area_expansion: String(cfg.expansionFraction),
      ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)),
    };
    const VARS: Array<{ key: string; i18nKey: Parameters<typeof t>[0] }> = [
      { key: 'input', i18nKey: 'var_desc_input' },
      { key: 'index', i18nKey: 'var_desc_index' },
      { key: 'year', i18nKey: 'var_desc_year' },
      { key: 'month', i18nKey: 'var_desc_month' },
      { key: 'day', i18nKey: 'var_desc_day' },
      { key: 'hour', i18nKey: 'var_desc_hour' },
      { key: 'minute', i18nKey: 'var_desc_minute' },
      { key: 'timezone', i18nKey: 'var_desc_timezone' },
      { key: 'lat', i18nKey: 'var_desc_lat' },
      { key: 'lon', i18nKey: 'var_desc_lon' },
      { key: 'duration', i18nKey: 'var_desc_duration' },
      { key: 'model', i18nKey: 'var_desc_model' },
      { key: 'redaction_style', i18nKey: 'var_desc_redaction_style' },
      { key: 'detect', i18nKey: 'var_desc_detect' },
      { key: 'min_confidence', i18nKey: 'var_desc_min_confidence' },
      { key: 'area_expansion', i18nKey: 'var_desc_area_expansion' },
    ];
    const tbody = document.getElementById('naming-vars-body')!;
    tbody.innerHTML = '';
    for (const v of VARS) {
      const val = values[v.key] ?? '';
      const tr = document.createElement('tr');
      const tdVar = document.createElement('td');
      tdVar.style.cssText = 'padding:3px 10px 3px 0;font-family:var(--mono);color:var(--text);white-space:nowrap;';
      tdVar.textContent = `{${v.key}}`;
      const tdDesc = document.createElement('td');
      tdDesc.style.cssText = 'padding:3px 10px 3px 0;color:var(--dim);';
      tdDesc.textContent = t(v.i18nKey);
      const tdVal = document.createElement('td');
      tdVal.style.cssText = 'padding:3px 0;font-family:var(--mono);color:var(--dim);';
      tdVal.textContent = val;
      tr.append(tdVar, tdDesc, tdVal);
      tbody.appendChild(tr);
    }
  }

  // ── Debug log ───────────────────────────────────────────────────────────────

  private initDebugLog(): void {
    const area = document.getElementById('debug-log-area');
    if (!area) return;
    const render = () => {
      const entries = getEntries();
      area.textContent = entries.join('\n');
      area.scrollTop = area.scrollHeight;
    };
    setOnUpdate(render);
    render(); // show any entries logged before init
  }

  private bindDebugLogButtons(): void {
    document.getElementById('copy-log-btn')?.addEventListener('click', async () => {
      await copyToClipboard();
      const status = document.getElementById('copy-log-status')!;
      status.textContent = t('copied');
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    });
    document.getElementById('clear-log-btn')?.addEventListener('click', () => {
      clearEntries();
      const area = document.getElementById('debug-log-area');
      if (area) area.textContent = '';
    });
    document.getElementById('defaults-btn')!.addEventListener('click', () => {
      setConfig({ ...DEFAULTS });
    });
    document.getElementById('delete-detections-btn')?.addEventListener('click', () => {
      tauriConfirm(t('confirm_delete_detections')).then((ok) => {
        if (!ok) return;
        clearDetectionCache()
          .then(() => this.rerenderActive())
          .catch(console.error);
      });
    });
  }

  // ── Inference status ────────────────────────────────────────────────────────

  private showDetecting(on: boolean, context: 'inference' | 'loading-image' | 'loading-model' = 'inference'): void {
    if (on) {
      let label: string;
      if (context === 'loading-model') {
        label = t('status_loading_model');
      } else if (context === 'loading-image') {
        label = t('status_loading_image');
      } else {
        const avg = getAverageInferenceMs();
        label = avg === null ? t('detecting_plain') : tpl('detecting_timed', { t: (avg / 1000).toFixed(1) });
      }
      this.detectStatusInline.textContent = label;
      this.detectStatusInline.classList.add('visible');
    } else {
      this.detectStatusInline.classList.remove('visible');
    }
  }

  private showDetectionResult(dets: import('./detector').Detection[]): void {
    this.files.clearExamplesLoading();
    this.detectStatusInline.classList.remove('visible');
    if (this.modelLoadAfterSwitch) {
      this.modelLoadAfterSwitch = false;
      this.modelLoadProgress.classList.remove('visible');
    }
    confirmLargeModelOk();
    void dets;
  }

  private showInferenceError(err: Error): void {
    this.files.clearExamplesLoading();
    this.detectStatusInline.classList.remove('visible');
    if (this.modelLoadAfterSwitch) {
      this.modelLoadAfterSwitch = false;
      this.modelLoadProgress.classList.remove('visible');
    }
    console.error('[app] inference error shown in UI:', err.message);
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('drop-zone')?.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) this.files.addFiles(e.dataTransfer.files);
    });
    document.addEventListener('dragenter', () => document.getElementById('drop-zone')?.classList.add('drag-over'));
    document.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) document.getElementById('drop-zone')?.classList.remove('drag-over');
    });

    document
      .getElementById('drop-zone')!
      .addEventListener('click', () => (document.getElementById('file-input') as HTMLInputElement).click());

    const openPicker = () => (document.getElementById('file-input') as HTMLInputElement).click();
    document.getElementById('pick-btn')!.addEventListener('click', openPicker);
    const fi = document.getElementById('file-input') as HTMLInputElement;
    fi.addEventListener('change', () => {
      if (fi.files?.length) this.files.addFiles(fi.files);
      fi.value = '';
    });

    document.getElementById('examples-btn')!.addEventListener('click', () => this.files.loadExamples());

    this.exportBtn.addEventListener('click', () => void this.exportManager.startExport(false));
    this.exportAllBtn.addEventListener('click', () => void this.exportManager.startExport(true));

    document.getElementById('model-radio-group')!.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'model') setConfig({ model: t.value as ModelChoice });
    });
    document.getElementById('mode-radio-group')!.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'drawMode') setConfig({ drawMode: t.value as AppConfig['drawMode'] });
    });
    document.getElementById('solidcolor-color-picker')?.addEventListener('input', (e) => {
      setConfig({ solidColor: (e.target as HTMLInputElement).value });
    });
    document.getElementById('metadata-radio-group')!.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'keepMetadata') setConfig({ keepMetadata: t.value as AppConfig['keepMetadata'] });
    });
    document.getElementById('audio-radio-group')!.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'keepAudio') setConfig({ keepAudio: t.value === 'keep' });
    });
    const confValueEl = document.getElementById('conf-value') as HTMLElement;
    const debouncedConfChange = debounce((val: number) => setConfig({ minConfidence: val }), 150);
    document.getElementById('conf-slider')!.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value) / 100;
      confValueEl.textContent = `${Math.round(val * 100)}%`;
      debouncedConfChange(val);
    });
    const expValueEl = document.getElementById('expansion-value') as HTMLElement;
    const debouncedExpChange = debounce((val: number) => setConfig({ expansionFraction: val }), 150);
    document.getElementById('expansion-slider')!.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value) / 100;
      expValueEl.textContent = `${Math.round(val * 100)}%`;
      debouncedExpChange(val);
    });
    document.getElementById('label-radio-group')!.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value;
      const labels = val === 'both' ? ['plate', 'person'] : [val];
      setConfig({ enabledLabels: labels });
    });

    window.addEventListener('configchange', (e) => void this.onConfigChange((e as CustomEvent<AppConfig>).detail));

    const namingInput = document.getElementById('naming-pattern-input') as HTMLInputElement | null;
    const debouncedNamingChange = debounce((value: string) => setConfig({ namingPattern: value }), 300);
    namingInput?.addEventListener('input', () => debouncedNamingChange(namingInput.value));

    document.getElementById('naming-info-btn')?.addEventListener('click', () => {
      const panel = document.getElementById('naming-info-panel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) void this.updateNamingInfoPanel();
    });
  }

  private async onConfigChange(cfg: AppConfig): Promise<void> {
    this.exportManager.markAllDirty();
    this.syncConfigUI();
    if (cfg.model !== this.prevModel) {
      this.prevModel = cfg.model;
      this.showDetecting(true, 'loading-model');
      this.modelLoadProgress.classList.add('visible');
      this.modelLoadBarFill.style.width = '0%';
      // setModel() clears memCache synchronously before downloading. Start the
      // clear-render immediately so detections disappear while the model loads.
      const modelPromise = setModel(cfg.model, (done, total) => {
        this.modelLoadBarFill.style.width = `${Math.round((done / total) * 100)}%`;
      });
      void this.rerenderActive();
      try {
        await modelPromise;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[app] model load failed:', error);
        this.detectStatusInline.classList.remove('visible');
        this.modelLoadProgress.classList.remove('visible');
        return;
      }
      // Keep the progress bar visible until inference finishes (bar stays at 100%).
      this.modelLoadBarFill.style.width = '100%';
      this.modelLoadAfterSwitch = true;
    }
    await this.rerenderActive();
  }

  private async rerenderActive(): Promise<void> {
    const item = this.store.items[this.store.activeIndex];
    if (!item) return;
    if (!item.isVideo) {
      const key = await makeImageKey(item.file, item.canvas.width, item.canvas.height);
      const cached = await getCachedDetections(key);
      if (cached !== null) {
        // Fast path: re-decode the image then overlay cached detections.
        this.showDetecting(true, 'loading-image');
        await renderImage(item.file, item.canvas);
        const ctx = item.canvas.getContext('2d')!;
        this.showDetecting(false);
        const filtered = applyFilters(cached, getConfig().minConfidence, getConfig().enabledLabels);
        applyDetections(ctx, filtered, getConfig().drawMode, getConfig().solidColor, getConfig().expansionFraction);
        this.showDetectionResult(filtered);
        (window as unknown as Record<string, unknown>).__lastDetections = filtered;
      } else {
        // No cache yet — render and schedule inference.
        this.showDetecting(true, 'loading-image');
        await renderImage(item.file, item.canvas);
        const ctx = item.canvas.getContext('2d')!;
        this.showDetecting(true, 'inference');
        scheduleInference(
          item.canvas,
          key,
          (dets) => {
            this.showDetecting(false);
            const filtered = applyFilters(dets, getConfig().minConfidence, getConfig().enabledLabels);
            applyDetections(ctx, filtered, getConfig().drawMode, getConfig().solidColor, getConfig().expansionFraction);
            this.showDetectionResult(filtered);
          },
          (err) => this.showInferenceError(err),
        );
      }
    } else {
      await item.player?.seekTo(item.player.currentTime);
    }
  }
}
