import { renderImage } from './imageRenderer';
import { VideoPlayer } from './videoPlayer';
import { runBatch } from './batchExporter';
import type { ExportItem } from './batchExporter';
import {
  getCachedDetections, scheduleInference, applyDetections,
  makeImageKey, getAverageInferenceMs, setModel,
} from './detector';
import { getConfig, setConfig, type AppConfig, type ModelChoice } from './config';
import { t, tpl, translateLabel, applyTranslations } from './i18n';
import { getEntries, clearEntries, setOnUpdate, copyToClipboard } from './debugLog';

interface MediaItem {
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
  exportRow: HTMLElement;
  exportBarFill: HTMLElement;
  exportEtaEl: HTMLElement;
  usesLibav: boolean;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return `${m}:${sec}`;
}

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5)  return t('almost_done');
  if (s < 60) return tpl('eta_s', { s });
  const m = Math.floor(s / 60), r = s % 60;
  return tpl('eta_ms', { m, r: r.toString().padStart(2, '0') });
}

/** Simple debounce — returns a wrapper that fires `fn` only after `ms` ms of silence. */
function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

export class App {
  private items: MediaItem[] = [];
  private activeIndex = -1;
  private exporting = false;
  private prevModel: ModelChoice = getConfig().model;


  // DOM refs
  private previewArea!: HTMLElement;
  private fileSelect!: HTMLSelectElement;
  private fileNav!: HTMLElement;
  private fileCounter!: HTMLElement;
  private navPrev!: HTMLButtonElement;
  private navNext!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;
  private exportAllBtn!: HTMLButtonElement;
  private globalProgressFill!: HTMLElement;
  private globalEta!: HTMLElement;
  private exportGlobalRow!: HTMLElement;
  private exportFileRows!: HTMLElement;
  private modelLoadProgress!: HTMLElement;
  private modelLoadBarFill!: HTMLElement;
  private modelLoadText!: HTMLElement;
  private trimSection!: HTMLElement;
  private trimStartInput!: HTMLInputElement;
  private trimEndInput!: HTMLInputElement;
  private trimTrackFill!: HTMLElement;
  private trimStartLabel!: HTMLElement;
  private trimEndLabel!: HTMLElement;
  private trimDurationLabel!: HTMLElement;
  private detectStatusInline!: HTMLElement;
  private detectResultEl!: HTMLElement;
  private libavWarningEl!: HTMLElement;
  private loadedSummary!: HTMLElement;
  private stepPreviewSubtitle!: HTMLElement;
  private audioSettingRow!: HTMLElement;

  init(): void {
    this.previewArea        = document.getElementById('preview-area')!;
    this.fileSelect         = document.getElementById('file-select') as HTMLSelectElement;
    this.fileNav            = document.getElementById('file-nav')!;
    this.fileCounter        = document.getElementById('file-counter')!;
    this.navPrev            = document.getElementById('nav-prev') as HTMLButtonElement;
    this.navNext            = document.getElementById('nav-next') as HTMLButtonElement;
    this.exportBtn          = document.getElementById('export-btn') as HTMLButtonElement;
    this.exportAllBtn       = document.getElementById('export-all-btn') as HTMLButtonElement;
    this.globalProgressFill = document.getElementById('global-progress-fill')!;
    this.globalEta          = document.getElementById('global-eta')!;
    this.exportGlobalRow    = document.getElementById('export-global-row')!;
    this.exportFileRows     = document.getElementById('export-file-rows')!;
    this.modelLoadProgress  = document.getElementById('model-load-progress')!;
    this.modelLoadBarFill   = document.getElementById('model-load-bar-fill')!;
    this.modelLoadText      = document.getElementById('model-load-text')!;
    this.trimSection        = document.getElementById('trim-section')!;
    this.trimStartInput     = document.getElementById('trim-start') as HTMLInputElement;
    this.trimEndInput       = document.getElementById('trim-end') as HTMLInputElement;
    this.trimTrackFill      = document.getElementById('trim-track-fill')!;
    this.trimStartLabel     = document.getElementById('trim-start-label')!;
    this.trimEndLabel       = document.getElementById('trim-end-label')!;
    this.trimDurationLabel  = document.getElementById('trim-duration-label')!;
    this.detectStatusInline = document.getElementById('detect-status-inline')!;
    this.detectResultEl     = document.getElementById('detect-result')!;
    this.libavWarningEl     = document.getElementById('libav-warning')!;
    this.loadedSummary      = document.getElementById('loaded-summary')!;
    this.stepPreviewSubtitle= document.getElementById('step-preview-subtitle')!;
    this.audioSettingRow    = document.getElementById('audio-setting-row')!;

    applyTranslations();
    this.bindEvents();
    this.syncConfigUI();
    this.initDebugLog();
    this.bindDebugLogButtons();

    // Test globals
    const w = window as unknown as Record<string, unknown>;
    w.__setDrawMode  = (m: string) => setConfig({ drawMode: m as AppConfig['drawMode'] });
    w.__setTrimStart = (t: number) => {
      const item = this.items[this.activeIndex];
      if (item?.isVideo) this.applyTrimStart(item, t);
    };
    // Sets trim without re-seeking (avoids triggering new inference for the test).
    w.__setTrimStartSilent = (t: number) => {
      const item = this.items[this.activeIndex];
      if (item?.isVideo) { item.trimStart = t; }
    };
    w.__setTrimEnd = (t: number) => {
      const item = this.items[this.activeIndex];
      if (item?.isVideo && item.player) {
        item.trimEnd = t;
        item.exported = false;
        this.updateExportBtnState();
        const dur   = item.player.duration;
        const steps = Number(this.trimEndInput.max);
        this.trimEndInput.value = String(Math.round((t / dur) * steps));
        this.updateTrimFill();
        this.updateTrimLabels(item);
        this.setActiveThumb('end');
        this.debouncedSeekEnd(item, t);
      }
    };
    // Sets trim end without re-seeking (for tests that don't need the preview frame).
    w.__setTrimEndSilent = (t: number) => {
      const item = this.items[this.activeIndex];
      if (item?.isVideo && item.player) {
        item.trimEnd = t;
        item.exported = false;
        this.updateExportBtnState();
        const dur   = item.player.duration;
        const steps = Number(this.trimEndInput.max);
        this.trimEndInput.value = String(Math.round((t / dur) * steps));
        this.updateTrimFill();
        this.updateTrimLabels(item);
      }
    };
  }

  private syncConfigUI(): void {
    const cfg = getConfig();
    const mr = document.querySelector<HTMLInputElement>(`input[name="model"][value="${cfg.model}"]`);
    if (mr) mr.checked = true;
    const dr = document.querySelector<HTMLInputElement>(`input[name="drawMode"][value="${cfg.drawMode}"]`);
    if (dr) dr.checked = true;
    const meta = document.querySelector<HTMLInputElement>(`input[name="keepMetadata"][value="${cfg.keepMetadata ? 'keep' : 'strip'}"]`);
    if (meta) meta.checked = true;
    const audio = document.querySelector<HTMLInputElement>(`input[name="keepAudio"][value="${cfg.keepAudio ? 'keep' : 'strip'}"]`);
    if (audio) audio.checked = true;
  }

  private updateAudioSettingVisibility(): void {
    this.audioSettingRow.hidden = !this.items.some(it => it.isVideo);
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
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
    document.getElementById('clear-log-btn')?.addEventListener('click', () => {
      clearEntries();
      const area = document.getElementById('debug-log-area');
      if (area) area.textContent = '';
    });
  }

  // ── Inference status ────────────────────────────────────────────────────────

  private showDetecting(on: boolean): void {
    if (on) {
      const avg = getAverageInferenceMs();
      this.detectStatusInline.textContent = avg === null
        ? t('detecting_plain')
        : tpl('detecting_timed', { t: (avg / 1000).toFixed(1) });
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
    this.detectResultEl.textContent = dets.length === 0
      ? t('no_detections')
      : parts.join(', ');
    this.detectResultEl.classList.add('visible');
  }

  // ── File nav ────────────────────────────────────────────────────────────────

  private updateFileNav(): void {
    const n = this.items.length;
    const i = this.activeIndex;
    if (n > 1) {
      this.fileNav.classList.add('visible');
      this.fileCounter.textContent = `${i + 1} / ${n}`;
      this.navPrev.disabled = i <= 0;
      this.navNext.disabled = i >= n - 1;
    } else {
      this.fileNav.classList.remove('visible');
    }
    // Update subtitle in step header
    this.stepPreviewSubtitle.textContent = n > 0 ? this.items[i]?.name ?? '' : '';
  }

  private updateLoadedSummary(): void {
    const n = this.items.length;
    this.loadedSummary.textContent = n === 0 ? '' : n === 1 ? t('files_loaded_one') : tpl('files_loaded_n', { n });
    // "Export all" is only meaningful when there are multiple files.
    this.exportAllBtn.style.display = n > 1 ? '' : 'none';
  }

  // ── Trim slider ─────────────────────────────────────────────────────────────

  private updateTrimFill(): void {
    const s   = Number(this.trimStartInput.value);
    const e   = Number(this.trimEndInput.value);
    const max = Number(this.trimStartInput.max);
    this.trimTrackFill.style.left  = `${(s / max) * 100}%`;
    this.trimTrackFill.style.width = `${((e - s) / max) * 100}%`;
  }

  private updateTrimLabels(item: MediaItem): void {
    const dur = item.player!.duration;
    const s   = item.trimStart ?? 0;
    const e   = item.trimEnd   ?? dur;
    this.trimStartLabel.textContent    = formatTime(s);
    this.trimEndLabel.textContent      = formatTime(e);
    this.trimDurationLabel.textContent = tpl('selected', { s: `${(e - s).toFixed(2)}s` });
  }

  /** Mark the canvas as stale (blurred/dimmed) while a seek is in flight. */
  private setCanvasStale(stale: boolean): void {
    this.previewArea.classList.toggle('stale', stale);
  }

  /** Seek to `sec`, marking canvas stale until the frame arrives. */
  private async seekAndUpdate(item: MediaItem, sec: number): Promise<void> {
    this.setCanvasStale(true);
    const drawn = await item.player!.seekTo(sec);
    // Only clear stale if this seek actually drew (not superseded by a newer one).
    if (drawn) this.setCanvasStale(false);
  }

  // Debounced version — fires 120 ms after the last slider movement.
  private readonly debouncedSeekStart = debounce((item: MediaItem, sec: number) => {
    void this.seekAndUpdate(item, sec);
  }, 120);

  private readonly debouncedSeekEnd = debounce((item: MediaItem, sec: number) => {
    void this.seekAndUpdate(item, sec);
  }, 120);

  private applyTrimStart(item: MediaItem, sec: number): void {
    item.trimStart = sec;
    const steps = Number(this.trimStartInput.max);
    const dur   = item.player!.duration;
    this.trimStartInput.value = String(Math.round((sec / dur) * steps));
    this.updateTrimFill();
    this.updateTrimLabels(item);
    this.setActiveThumb('start');
    this.debouncedSeekStart(item, sec);
  }

  private setActiveThumb(which: 'start' | 'end'): void {
    this.trimStartInput.classList.toggle('active-thumb', which === 'start');
    this.trimEndInput.classList.toggle('active-thumb',   which === 'end');
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById('drop-zone')?.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) this.addFiles(e.dataTransfer.files);
    });
    document.addEventListener('dragenter', () =>
      document.getElementById('drop-zone')?.classList.add('drag-over'));
    document.addEventListener('dragleave', e => {
      if (e.relatedTarget === null)
        document.getElementById('drop-zone')?.classList.remove('drag-over');
    });

    document.getElementById('drop-zone')!.addEventListener('click', () =>
      (document.getElementById('file-input') as HTMLInputElement).click());

    const openPicker = () => (document.getElementById('file-input') as HTMLInputElement).click();
    document.getElementById('pick-btn')!.addEventListener('click', openPicker);
    const fi = document.getElementById('file-input') as HTMLInputElement;
    fi.addEventListener('change', () => {
      if (fi.files?.length) this.addFiles(fi.files);
      fi.value = '';
    });

    this.fileSelect.addEventListener('change', () => this.switchTo(this.fileSelect.selectedIndex));
    this.navPrev.addEventListener('click', () => { if (this.activeIndex > 0) this.switchTo(this.activeIndex - 1); });
    this.navNext.addEventListener('click', () => { if (this.activeIndex < this.items.length - 1) this.switchTo(this.activeIndex + 1); });

    this.exportBtn.addEventListener('click',    () => this.startExport(false));
    this.exportAllBtn.addEventListener('click', () => this.startExport(true));

    // Active-thumb highlight: set on pointerdown, so even a single tap highlights.
    this.trimStartInput.addEventListener('pointerdown', () => this.setActiveThumb('start'));
    this.trimEndInput.addEventListener('pointerdown',   () => this.setActiveThumb('end'));

    this.trimStartInput.addEventListener('input', () => this.onTrimStartInput());
    this.trimEndInput.addEventListener('input',   () => this.onTrimEndInput());

    document.getElementById('model-radio-group')!.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'model') setConfig({ model: t.value as ModelChoice });
    });
    document.getElementById('mode-radio-group')!.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'drawMode') setConfig({ drawMode: t.value as AppConfig['drawMode'] });
    });
    document.getElementById('metadata-radio-group')!.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'keepMetadata') setConfig({ keepMetadata: t.value === 'keep' });
    });
    document.getElementById('audio-radio-group')!.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'keepAudio') setConfig({ keepAudio: t.value === 'keep' });
    });

    window.addEventListener('configchange', (e) =>
      void this.onConfigChange((e as CustomEvent<AppConfig>).detail));
  }

  private onTrimStartInput(): void {
    const item = this.items[this.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const max    = Number(this.trimStartInput.max);
    const endVal = Number(this.trimEndInput.value);
    if (Number(this.trimStartInput.value) >= endVal)
      this.trimStartInput.value = String(Math.max(0, endVal - 1));
    item.trimStart = (Number(this.trimStartInput.value) / max) * item.player.duration;
    item.exported = false;
    this.updateExportBtnState();
    this.updateTrimFill();
    this.updateTrimLabels(item);
    // Mark stale immediately; debounced seek fires after 120 ms of silence.
    this.setCanvasStale(true);
    this.debouncedSeekStart(item, item.trimStart);
  }

  private onTrimEndInput(): void {
    const item = this.items[this.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const max      = Number(this.trimEndInput.max);
    const startVal = Number(this.trimStartInput.value);
    if (Number(this.trimEndInput.value) <= startVal)
      this.trimEndInput.value = String(Math.min(max, startVal + 1));
    item.trimEnd = (Number(this.trimEndInput.value) / max) * item.player.duration;
    item.exported = false;
    this.updateExportBtnState();
    this.updateTrimFill();
    this.updateTrimLabels(item);
    this.setCanvasStale(true);
    this.debouncedSeekEnd(item, item.trimEnd);
  }

  private async onConfigChange(cfg: AppConfig): Promise<void> {
    if (cfg.model !== this.prevModel) {
      this.prevModel = cfg.model;
      this.showDetecting(true);
      this.detectResultEl.textContent = t('downloading_model');
      this.modelLoadProgress.classList.add('visible');
      this.modelLoadBarFill.style.width = '0%';
      this.modelLoadText.textContent = cfg.model === 'detect_n'
        ? t('loading_model') : tpl('loading_chunks_start', { total: cfg.model === 'detect_x' ? 9 : '?' });
      try {
        await setModel(cfg.model, (done, total) => {
          this.modelLoadBarFill.style.width = `${Math.round(done / total * 100)}%`;
          this.modelLoadText.textContent    = cfg.model === 'detect_n'
            ? t('loading_model') : tpl('loading_chunks', { done, total });
        });
      } finally {
        this.modelLoadProgress.classList.remove('visible');
      }
    }
    await this.rerenderActive();
  }

  private async rerenderActive(): Promise<void> {
    const item = this.items[this.activeIndex];
    if (!item) return;
    if (!item.isVideo) {
      await renderImage(item.file, item.canvas);
      const ctx = item.canvas.getContext('2d')!;
      const key = makeImageKey(item.file, item.canvas.width, item.canvas.height);
      const cached = await getCachedDetections(key);
      if (cached !== null) {
        this.showDetecting(false);
        applyDetections(ctx, cached, getConfig().drawMode);
        this.showDetectionResult(cached);
      } else {
        this.showDetecting(true);
        scheduleInference(item.canvas, key, dets => {
          this.showDetecting(false);
          applyDetections(ctx, dets, getConfig().drawMode);
          this.showDetectionResult(dets);
        });
      }
    } else {
      await item.player?.seekTo(item.player.currentTime);
    }
  }

  // ── File management ─────────────────────────────────────────────────────────

  private addFiles(files: FileList): void {
    for (const file of files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        this.addFile(file);
      }
    }
  }

  private addFile(file: File): void {
    const isVideo = file.type.startsWith('video/');
    const index   = this.items.length;

    // Canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    this.previewArea.appendChild(wrapper);

    // File select option
    const opt = document.createElement('option');
    opt.textContent = file.name;
    this.fileSelect.appendChild(opt);

    // Export row
    const exportRow = document.createElement('div');
    exportRow.className = 'export-file-row';
    const rowName = document.createElement('span');
    rowName.className = 'export-file-name';
    rowName.textContent = file.name; rowName.title = file.name;
    const rowBarTrack = document.createElement('div');
    rowBarTrack.className = 'export-file-bar-track';
    const rowBarFill = document.createElement('div');
    rowBarFill.className = 'export-file-bar-fill';
    rowBarTrack.appendChild(rowBarFill);
    const rowEta = document.createElement('span');
    rowEta.className = 'export-file-eta';
    exportRow.append(rowName, rowBarTrack, rowEta);
    this.exportFileRows.appendChild(exportRow);

    const item: MediaItem = {
      name: file.name, isVideo, file, wrapper, canvas,
      exportRow, exportBarFill: rowBarFill, exportEtaEl: rowEta,
      loaded: false, exported: false, usesLibav: false,
    };
    this.items.push(item);
    this.updateAudioSettingVisibility();

    // Reveal step cards on first file
    if (this.items.length === 1) {
      document.getElementById('step-preview')!.classList.add('active');
      document.getElementById('step-settings')!.classList.add('active');
      document.getElementById('step-export')!.classList.add('active');
    }

    this.updateLoadedSummary();

    if (isVideo) {
      const player = new VideoPlayer(canvas, this.detectStatusInline);
      item.player = player;
      (window as unknown as Record<string, unknown>).__activePlayer = player;

      player.onLibavFallback = () => {
        item.usesLibav = true;
        if (this.activeIndex === index) this.libavWarningEl.hidden = false;
      };

      // Show detection result summary when this player's frame is detected.
      // Only update UI if this item is the active one.
      player.onDetection = (dets) => {
        if (this.activeIndex === index) this.showDetectionResult(dets);
      };

      player.load(file).then(() => {
        item.loaded = true;
        canvas.dataset.loaded = 'true';
        if (this.activeIndex === index) this.setupTrimSlider(item);
      }).catch(err => {
        console.error(`Failed to load video "${file.name}":`, err);
        this.showError(wrapper, canvas, err.message);
      });
    } else {
      renderImage(file, canvas).then(async () => {
        item.loaded = true;
        canvas.dataset.loaded = 'true';
        const ctx = canvas.getContext('2d')!;
        const key = makeImageKey(file, canvas.width, canvas.height);
        const cached = await getCachedDetections(key);
        if (cached !== null) {
          applyDetections(ctx, cached, getConfig().drawMode);
          if (this.activeIndex === index) this.showDetectionResult(cached);
        } else {
          this.showDetecting(true);
          scheduleInference(canvas, key, dets => {
            this.showDetecting(false);
            applyDetections(ctx, dets, getConfig().drawMode);
            if (this.activeIndex === index) this.showDetectionResult(dets);
          });
        }
      }).catch(err => {
        console.error(`Failed to render image "${file.name}":`, err);
        this.showError(wrapper, canvas, err.message);
      });
    }

    this.switchTo(index);
  }

  private showError(wrapper: HTMLDivElement, canvas: HTMLCanvasElement, msg: string): void {
    canvas.remove();
    const p = document.createElement('p');
    p.className = 'error-msg';
    p.textContent = `Error: ${msg}`;
    wrapper.appendChild(p);
  }

  private setupTrimSlider(item: MediaItem): void {
    const dur   = item.player!.duration;
    const STEPS = 1000;
    this.trimStartInput.value = String(Math.round(((item.trimStart ?? 0)   / dur) * STEPS));
    this.trimEndInput.value   = String(Math.round(((item.trimEnd   ?? dur) / dur) * STEPS));
    this.updateTrimFill();
    this.updateTrimLabels(item);
    // Default: start thumb is active (highlighted).
    this.setActiveThumb('start');
    this.setCanvasStale(false);
  }

  private switchTo(index: number): void {
    if (this.activeIndex >= 0) {
      this.items[this.activeIndex].wrapper.classList.remove('active');
    }
    this.activeIndex = index;
    this.fileSelect.selectedIndex = index;
    // Clear detection result when switching to a new file.
    this.detectResultEl.classList.remove('visible');
    this.detectStatusInline.classList.remove('visible');

    const item = this.items[index];
    item.wrapper.classList.add('active');

    if (item.player) {
      (window as unknown as Record<string, unknown>).__activePlayer = item.player;
    }

    if (item.isVideo) {
      this.trimSection.classList.add('visible');
      if (item.loaded) this.setupTrimSlider(item);
    } else {
      this.trimSection.classList.remove('visible');
    }

    this.libavWarningEl.hidden = !item.usesLibav;

    this.updateFileNav();
    this.updateExportBtnState();
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  private updateExportBtnState(): void {
    if (this.exporting) return;
    const active = this.items[this.activeIndex];
    this.exportBtn.disabled    = !active || active.exported;
    this.exportAllBtn.disabled = this.items.length === 0 || this.items.every(it => it.exported);
  }

  private async startExport(forceAll: boolean): Promise<void> {
    if (this.exporting || this.items.length === 0) return;
    this.exporting = true;
    this.exportBtn.disabled    = true;
    this.exportAllBtn.disabled = true;

    if (forceAll) {
      this.items.forEach(it => { it.exported = false; });
    }

    // "Export current file" exports only the active item; "Export all" exports everything.
    const pending = forceAll
      ? this.items.filter(it => !it.exported)
      : [this.items[this.activeIndex]].filter(it => it !== undefined && !it.exported);
    if (pending.length === 0) {
      this.exporting = false;
      this.updateExportBtnState();
      return;
    }

    const showGlobal = pending.length > 1;
    if (showGlobal) {
      this.exportGlobalRow.classList.add('visible');
      this.globalProgressFill.style.width = '0%';
      this.globalEta.textContent = t('estimating');
    }

    pending.forEach(it => it.exportRow.classList.add('active'));

    const exportStart    = performance.now();
    let completedCount   = 0;
    const total          = pending.length;
    const fileStartTimes = new Array<number>(total).fill(0);

    const { keepMetadata, keepAudio } = getConfig();
    const exportItems: ExportItem[] = pending.map(it => ({
      name:      it.name,
      isVideo:   it.isVideo,
      canvas:    it.isVideo ? undefined : it.canvas,
      file:      it.file,
      trimStart: it.trimStart,
      trimEnd:   it.trimEnd,
      keepMetadata,
      keepAudio,
    }));

    await runBatch(exportItems, {
      onFileStart: (i) => {
        fileStartTimes[i] = performance.now();
        pending[i].exportBarFill.style.width = '0%';
        pending[i].exportEtaEl.textContent   = t('estimating');
      },
      onFileProgress: (i, p) => {
        pending[i].exportBarFill.style.width = `${Math.round(p * 100)}%`;
        if (p > 0.01) {
          const elapsed = performance.now() - fileStartTimes[i];
          pending[i].exportEtaEl.textContent = formatEta(elapsed * (1 - p) / p);
        }
        if (showGlobal) {
          const gp = (completedCount + p) / total;
          this.globalProgressFill.style.width = `${Math.round(gp * 100)}%`;
          const elapsed = performance.now() - exportStart;
          if (gp > 0.01) this.globalEta.textContent = formatEta(elapsed * (1 - gp) / gp);
        }
      },
      onFileEnd: (i, error) => {
        if (!error) {
          // Only mark as exported if trim wasn't changed during the export run.
          const trimUnchanged = pending[i].trimStart === exportItems[i].trimStart
            && pending[i].trimEnd === exportItems[i].trimEnd;
          if (trimUnchanged) pending[i].exported = true;
          pending[i].exportBarFill.style.width = '100%';
          pending[i].exportEtaEl.textContent   = t('done');
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
          this.globalEta.textContent = p >= 1 ? t('done') : formatEta(elapsed * (1 - p) / p);
        }
      },
    });

    this.exporting = false;
    this.updateExportBtnState();

    if (showGlobal) {
      setTimeout(() => {
        this.exportGlobalRow.classList.remove('visible');
        this.globalProgressFill.style.width = '0%';
      }, 3000);
    }
    pending.forEach(it => setTimeout(() => it.exportRow.classList.remove('active'), 3000));
  }
}
