import { VideoPlayer } from './videoPlayer';
import { extractImageMeta, extractVideoMeta } from './fileMeta';
import {
  getCachedDetections,
  scheduleInference,
  makeImageKey,
  filterByConf,
} from './detector';
import { loadTrim } from './trimStorage';
import { applyDetections } from './detectionDrawer';
import { renderImage } from './imageRenderer';
import { getConfig } from './config';
import { t, tpl } from './i18n';
import { type MediaItem, type ItemStore } from './types';
import type { Detection } from './detector';
import type { PlaybackController } from './playbackController';
import type { ExportManager } from './exportManager';

export class FileManager {
  private examplesBtn: HTMLButtonElement | null = null;

  clearExamplesLoading(): void {
    if (!this.examplesBtn) return;
    this.examplesBtn.classList.remove('loading');
    this.examplesBtn = null;
  }

  constructor(
    private readonly store: ItemStore,
    private readonly previewArea: HTMLElement,
    private readonly fileSelect: HTMLSelectElement,
    private readonly fileNav: HTMLElement,
    private readonly fileCounter: HTMLElement,
    private readonly navPrev: HTMLButtonElement,
    private readonly navNext: HTMLButtonElement,
    private readonly exportFileRows: HTMLElement,
    private readonly loadedSummary: HTMLElement,
    private readonly stepPreviewSubtitle: HTMLElement,
    private readonly audioSettingRow: HTMLElement,
    private readonly libavWarningEl: HTMLElement,
    private readonly detectStatusInline: HTMLElement,
    private readonly exportAllBtn: HTMLButtonElement,
    private readonly playback: PlaybackController,
    private readonly exportManager: ExportManager,
    // Callbacks for inference UI (owned by App)
    private readonly onShowDetecting: (on: boolean) => void,
    private readonly onShowDetectionResult: (dets: Detection[]) => void,
    private readonly onShowInferenceError: (err: Error) => void,
    private readonly onRerenderActive: () => Promise<void>,
    // Called after store.activeIndex is updated, for App to coordinate
    private readonly onAfterSwitchTo: (index: number) => void,
  ) {
    fileSelect.addEventListener('change', () => this.switchTo(fileSelect.selectedIndex));
    navPrev.addEventListener('click', () => {
      if (store.activeIndex > 0) this.switchTo(store.activeIndex - 1);
    });
    navNext.addEventListener('click', () => {
      if (store.activeIndex < store.items.length - 1) this.switchTo(store.activeIndex + 1);
    });
  }

  addFiles(files: FileList): void {
    for (const file of files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        this.addFile(file);
      }
    }
  }

  async loadExamples(): Promise<void> {
    const btn = document.getElementById('examples-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.classList.add('loading');
    this.examplesBtn = btn;
    try {
      const [imgResp, vidResp] = await Promise.all([
        fetch('examples/jpeg.jpg'),
        fetch('examples/av1.mp4'),
      ]);
      if (!imgResp.ok || !vidResp.ok) throw new Error('Failed to fetch example files');
      const [imgBlob, vidBlob] = await Promise.all([imgResp.blob(), vidResp.blob()]);
      const imgFile = new File([imgBlob], 'jpeg.jpg', { type: 'image/jpeg' });
      const vidFile = new File([vidBlob], 'av1.mp4', { type: 'video/mp4' });
      // Add image first and switch to it; add video without switching.
      this.addFile(imgFile, true);
      this.addFile(vidFile, false);
    } catch (err) {
      console.error('Failed to load examples:', err);
      btn.disabled = false;
      this.clearExamplesLoading();
    }
  }

  addFile(file: File, switchToFile = true): void {
    const isVideo = file.type.startsWith('video/');
    const index = this.store.items.length;

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
    rowName.textContent = file.name;
    rowName.title = file.name;
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
      name: file.name,
      isVideo,
      file,
      wrapper,
      canvas,
      exportRow,
      exportBarFill: rowBarFill,
      exportEtaEl: rowEta,
      loaded: false,
      exported: false,
      usesLibav: false,
      metaPromise: Promise.resolve({}),
    };
    // Kick off metadata extraction fire-and-forget; cache result on item.
    if (isVideo) {
      item.metaPromise = extractVideoMeta(file).then((m) => { item.meta = m; return m; }).catch((err) => {
        console.warn(`[app] video meta extraction failed for "${file.name}":`, err);
        return {};
      });
    } else {
      item.metaPromise = extractImageMeta(file).then((m) => { item.meta = m; return m; }).catch((err) => {
        console.warn(`[app] image meta extraction failed for "${file.name}":`, err);
        return {};
      });
    }
    this.store.items.push(item);
    this.updateAudioSettingVisibility();

    // Reveal step cards on first file
    if (this.store.items.length === 1) {
      document.getElementById('step-preview')!.classList.add('active');
      document.getElementById('step-settings')!.classList.add('active');
      document.getElementById('step-export')!.classList.add('active');
    }

    this.updateLoadedSummary();
    this.updateFileNav();

    if (isVideo) {
      const player = new VideoPlayer(canvas, this.detectStatusInline);
      item.player = player;
      (window as unknown as Record<string, unknown>).__activePlayer = player;

      player.onLibavFallback = () => {
        item.usesLibav = true;
        if (this.store.activeIndex === index) this.libavWarningEl.hidden = false;
      };

      // Show detection result summary when this player's frame is detected.
      // Only update UI if this item is the active one.
      player.onDetection = (dets) => {
        if (this.store.activeIndex === index) this.onShowDetectionResult(dets);
      };

      player
        .load(file)
        .then(async () => {
          item.loaded = true;
          canvas.dataset.loaded = 'true';
          if (this.store.activeIndex === index) this.updatePreviewAspectRatio();
          const saved = await loadTrim(`${file.name}|${file.size}`);
          if (saved && item.player) {
            const dur = item.player.duration;
            item.trimStart = Math.max(0, Math.min(saved.start, dur));
            item.trimEnd = Math.max(item.trimStart, Math.min(saved.end, dur));
          }
          if (this.store.activeIndex === index) this.playback.setupTrimSlider(item);
        })
        .catch((err) => {
          console.error(`Failed to load video "${file.name}":`, err);
          this.showError(wrapper, canvas, err.message);
        });
    } else {
      renderImage(file, canvas)
        .then(async () => {
          item.loaded = true;
          canvas.dataset.loaded = 'true';
          if (this.store.activeIndex === index) this.updatePreviewAspectRatio();
          const ctx = canvas.getContext('2d')!;
          const key = await makeImageKey(file, canvas.width, canvas.height);
          const cached = await getCachedDetections(key);
          if (cached !== null) {
            const filtered = filterByConf(cached, getConfig().minConfidence);
            applyDetections(ctx, filtered, getConfig().drawMode);
            if (this.store.activeIndex === index) {
              this.onShowDetectionResult(filtered);
              (window as unknown as Record<string, unknown>).__lastDetections = filtered;
            } else {
              this.clearExamplesLoading();
            }
          } else {
            this.onShowDetecting(true);
            scheduleInference(
              canvas,
              key,
              (dets) => {
                this.onShowDetecting(false);
                const filtered = filterByConf(dets, getConfig().minConfidence);
                applyDetections(ctx, filtered, getConfig().drawMode);
                if (this.store.activeIndex === index) {
                  this.onShowDetectionResult(filtered);
                } else {
                  this.clearExamplesLoading();
                }
              },
              (err) => {
                if (this.store.activeIndex === index) {
                  this.onShowInferenceError(err);
                } else {
                  this.clearExamplesLoading();
                }
              },
            );
          }
        })
        .catch((err) => {
          console.error(`Failed to render image "${file.name}":`, err);
          this.clearExamplesLoading();
          this.showError(wrapper, canvas, err.message);
        });
    }

    if (switchToFile) this.switchTo(index);
  }

  switchTo(index: number): void {
    if (this.store.activeIndex >= 0) {
      this.store.items[this.store.activeIndex].wrapper.classList.remove('active');
    }
    this.store.activeIndex = index;
    this.fileSelect.selectedIndex = index;

    const item = this.store.items[index];
    item.wrapper.classList.add('active');

    if (item.player) {
      (window as unknown as Record<string, unknown>).__activePlayer = item.player;
    }

    this.playback.onActiveChanged(item);
    this.libavWarningEl.hidden = !item.usesLibav;

    this.updateFileNav();
    this.exportManager.updateBtnState();
    this.updatePreviewAspectRatio();
    this.onAfterSwitchTo(index);
    if (item.loaded) void this.onRerenderActive();
  }

  updateFileNav(): void {
    const n = this.store.items.length;
    const i = this.store.activeIndex;
    if (n > 1) {
      this.fileNav.classList.add('visible');
      this.fileCounter.textContent = `${i + 1} / ${n}`;
      this.navPrev.disabled = i <= 0;
      this.navNext.disabled = i >= n - 1;
    } else {
      this.fileNav.classList.remove('visible');
    }
    this.stepPreviewSubtitle.textContent = n > 0 ? (this.store.items[i]?.name ?? '') : '';
  }

  updateLoadedSummary(): void {
    const n = this.store.items.length;
    this.loadedSummary.textContent = n === 0 ? '' : n === 1 ? t('files_loaded_one') : tpl('files_loaded_n', { n });
    // "Export all" is only meaningful when there are multiple files.
    this.exportAllBtn.style.display = n > 1 ? '' : 'none';
  }

  updateAudioSettingVisibility(): void {
    this.audioSettingRow.hidden = !this.store.items.some((it) => it.isVideo);
  }

  updatePreviewAspectRatio(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item) return;
    const { width, height } = item.canvas;
    if (width > 0 && height > 0) {
      this.previewArea.style.aspectRatio = `${width} / ${height}`;
    }
  }

  showError(wrapper: HTMLDivElement, canvas: HTMLCanvasElement, msg: string): void {
    canvas.remove();
    const p = document.createElement('p');
    p.className = 'error-msg';
    p.textContent = `Error: ${msg}`;
    wrapper.appendChild(p);
  }
}
