import {
  getCachedDetections,
  scheduleInference,
  applyDetections,
  makeImageKey,
  getAverageInferenceMs,
  setModel,
  clearDetectionCache,
  filterByConf,
} from './detector';
import { getConfig, setConfig, DEFAULTS, type AppConfig, type ModelChoice } from './config';
import { t, tpl, translateLabel, applyTranslations } from './i18n';
import { getEntries, clearEntries, setOnUpdate, copyToClipboard } from './debugLog';
import { renderImage } from './imageRenderer';
import { type ItemStore, debounce } from './types';
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
  private exportFileRows!: HTMLElement;
  private modelLoadProgress!: HTMLElement;
  private modelLoadBarFill!: HTMLElement;
  private modelLoadText!: HTMLElement;
  private detectStatusInline!: HTMLElement;
  private detectResultEl!: HTMLElement;
  private libavWarningEl!: HTMLElement;
  private loadedSummary!: HTMLElement;
  private stepPreviewSubtitle!: HTMLElement;
  private audioSettingRow!: HTMLElement;

  init(): void {
    this.previewArea = document.getElementById('preview-area')!;
    this.exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
    this.exportAllBtn = document.getElementById('export-all-btn') as HTMLButtonElement;
    this.globalProgressFill = document.getElementById('global-progress-fill')!;
    this.globalEta = document.getElementById('global-eta')!;
    this.exportGlobalRow = document.getElementById('export-global-row')!;
    this.exportFileRows = document.getElementById('export-file-rows')!;
    this.modelLoadProgress = document.getElementById('model-load-progress')!;
    this.modelLoadBarFill = document.getElementById('model-load-bar-fill')!;
    this.modelLoadText = document.getElementById('model-load-text')!;
    this.detectStatusInline = document.getElementById('detect-status-inline')!;
    this.detectResultEl = document.getElementById('detect-result')!;
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

    this.playback = new PlaybackController(
      this.store,
      this.previewArea,
      document.getElementById('trim-section')!,
      document.getElementById('trim-start') as HTMLInputElement,
      document.getElementById('trim-end') as HTMLInputElement,
      document.getElementById('trim-track-fill')!,
      document.getElementById('trim-start-label')!,
      document.getElementById('trim-end-label')!,
      document.getElementById('trim-duration-label')!,
      (_item) => {
        // Trim changed: refresh export button state.
        this.exportManager.updateBtnState();
      },
    );

    this.files = new FileManager(
      this.store,
      this.previewArea,
      document.getElementById('file-select') as HTMLSelectElement,
      document.getElementById('file-nav')!,
      document.getElementById('file-counter')!,
      document.getElementById('nav-prev') as HTMLButtonElement,
      document.getElementById('nav-next') as HTMLButtonElement,
      this.exportFileRows,
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
        // After switchTo: clear detection result UI (owned by App).
        this.detectResultEl.classList.remove('visible', 'error');
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
        const dur = item.player.duration;
        const steps = Number((document.getElementById('trim-end') as HTMLInputElement).max);
        (document.getElementById('trim-end') as HTMLInputElement).value = String(Math.round((t / dur) * steps));
        this.playback.updateTrimFill();
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
    const ni = document.getElementById('naming-pattern-input') as HTMLInputElement | null;
    if (ni) ni.value = cfg.namingPattern;
  }

  private async updateNamingInfoPanel(): Promise<void> {
    const panel = document.getElementById('naming-info-panel');
    if (!panel || panel.hidden) return;
    const item = this.store.items[this.store.activeIndex];
    const stem = item ? item.name.replace(/\.[^.]+$/, '') : '';
    const meta = item ? (item.meta ?? await item.metaPromise) : {};
    const values: Record<string, string> = {
      input: stem,
      index: '1',
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
      if (!confirm(t('confirm_delete_detections'))) return;
      clearDetectionCache()
        .then(() => this.rerenderActive())
        .catch(console.error);
    });
  }

  // ── Inference status ────────────────────────────────────────────────────────

  private showDetecting(on: boolean): void {
    if (on) {
      const avg = getAverageInferenceMs();
      this.detectStatusInline.textContent =
        avg === null ? t('detecting_plain') : tpl('detecting_timed', { t: (avg / 1000).toFixed(1) });
      this.detectStatusInline.classList.add('visible');
      this.detectResultEl.textContent = t('computing');
      this.detectResultEl.classList.add('visible');
    } else {
      this.detectStatusInline.classList.remove('visible');
    }
  }

  private showDetectionResult(dets: import('./detector').Detection[]): void {
    this.detectStatusInline.classList.remove('visible');
    const counts: Record<string, number> = {};
    for (const d of dets) counts[d.label] = (counts[d.label] ?? 0) + 1;
    const parts = Object.entries(counts).map(([label, n]) => `${n} ${translateLabel(label)}`);
    this.detectResultEl.textContent = dets.length === 0 ? t('no_detections') : parts.join(', ');
    this.detectResultEl.classList.remove('error');
    this.detectResultEl.classList.add('visible');
  }

  private showInferenceError(err: Error): void {
    this.detectStatusInline.classList.remove('visible');
    this.detectResultEl.textContent = t('detection_failed');
    this.detectResultEl.classList.add('visible', 'error');
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
      this.showDetecting(true);
      this.detectResultEl.textContent = t('downloading_model');
      this.modelLoadProgress.classList.add('visible');
      this.modelLoadBarFill.style.width = '0%';
      this.modelLoadText.textContent =
        cfg.model === 'detect_n'
          ? t('loading_model')
          : tpl('loading_chunks_start', { total: cfg.model === 'detect_x' ? 9 : '?' });
      // setModel() clears memCache synchronously before downloading. Start the
      // clear-render immediately so detections disappear while the model loads.
      const modelPromise = setModel(cfg.model, (done, total) => {
        this.modelLoadBarFill.style.width = `${Math.round((done / total) * 100)}%`;
        this.modelLoadText.textContent =
          cfg.model === 'detect_n' ? t('loading_model') : tpl('loading_chunks', { done, total });
      });
      void this.rerenderActive();
      try {
        await modelPromise;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[app] model load failed:', error);
        this.detectStatusInline.classList.remove('visible');
        this.detectResultEl.textContent = t('model_load_failed');
        this.detectResultEl.classList.add('visible', 'error');
        return;
      } finally {
        this.modelLoadProgress.classList.remove('visible');
      }
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
        await renderImage(item.file, item.canvas);
        const ctx = item.canvas.getContext('2d')!;
        this.showDetecting(false);
        const filtered = filterByConf(cached, getConfig().minConfidence);
        applyDetections(ctx, filtered, getConfig().drawMode);
        this.showDetectionResult(filtered);
        (window as unknown as Record<string, unknown>).__lastDetections = filtered;
      } else {
        // No cache yet — render and schedule inference.
        await renderImage(item.file, item.canvas);
        const ctx = item.canvas.getContext('2d')!;
        this.showDetecting(true);
        scheduleInference(
          item.canvas,
          key,
          (dets) => {
            this.showDetecting(false);
            const filtered = filterByConf(dets, getConfig().minConfidence);
            applyDetections(ctx, filtered, getConfig().drawMode);
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
