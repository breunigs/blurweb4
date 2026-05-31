import { VideoPlayer } from './videoPlayer';
import { extractImageMeta, extractVideoMeta } from './fileMeta';
import {
  getCachedDetections,
  scheduleInference,
  makeImageKey,
  applyFilters,
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
  private fileListEl: HTMLElement = document.getElementById('file-list')!

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }

  private updateFileListMeta(item: MediaItem): void {
    if (item.isVideo && item.player && item.player.duration > 0) {
      item.fileListDurationEl.textContent = this.formatDuration(item.player.duration);
    }
    if (item.canvas.width > 0 && item.canvas.height > 0) {
      item.fileListDimsEl.textContent = `${item.canvas.width}×${item.canvas.height}`;
    }
    item.fileListSizeEl.textContent = this.formatFileSize(item.file.size);
  }

  clearExamplesLoading(): void {
    if (!this.examplesBtn) return;
    this.examplesBtn.classList.remove('loading');
    this.examplesBtn = null;
  }

  constructor(
    private readonly store: ItemStore,
    private readonly previewArea: HTMLElement,
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
  ) {}

  addFiles(files: FileList): void {
    for (const file of files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const alreadyLoaded = this.store.items.some(
          (it) => it.file.name === file.name && it.file.size === file.size,
        );
        if (!alreadyLoaded) this.addFile(file);
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

    // Canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    this.previewArea.appendChild(wrapper);

    // File list row
    const fileListRow = document.createElement('div');
    fileListRow.className = 'file-list-row';

    const fileListIcon = document.createElement('span');
    fileListIcon.className = 'file-list-icon';
    fileListIcon.innerHTML = isVideo
      ? '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="10" height="10" rx="1.5"/><polyline points="11,6 15,4 15,12 11,10"/></svg>'
      : '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="14" height="14" rx="2"/><polyline points="1,11 5,7 8,10 11,7 15,12"/><circle cx="5.5" cy="4.5" r="1.5"/></svg>';

    const fileListName = document.createElement('span');
    fileListName.className = 'file-list-name';
    fileListName.textContent = file.name;
    fileListName.title = file.name;

    const rowEta = document.createElement('span');
    rowEta.className = 'file-list-eta col-eta';

    const fileListDuration = document.createElement('span');
    fileListDuration.className = 'file-list-duration';

    const fileListDims = document.createElement('span');
    fileListDims.className = 'file-list-dims';

    const fileListSize = document.createElement('span');
    fileListSize.className = 'file-list-size';
    fileListSize.textContent = this.formatFileSize(file.size);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-list-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.setAttribute('aria-label', 'Remove file');

    // Progress bar: absolutely positioned 2px bottom overlay
    const rowBarFill = document.createElement('div');
    rowBarFill.className = 'file-list-bar-fill';

    fileListRow.append(fileListIcon, fileListName, rowEta, fileListDuration, fileListDims, fileListSize, removeBtn, rowBarFill);
    this.fileListEl.appendChild(fileListRow);

    const item: MediaItem = {
      name: file.name,
      isVideo,
      file,
      wrapper,
      canvas,
      exportBarFill: rowBarFill,
      exportEtaEl: rowEta,
      fileListRow,
      fileListDurationEl: fileListDuration,
      fileListDimsEl: fileListDims,
      fileListSizeEl: fileListSize,
      loaded: false,
      exported: false,
      usesLibav: false,
      metaPromise: Promise.resolve({}),
    };

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeFile(item);
    });
    fileListRow.addEventListener('click', () => {
      const idx = this.store.items.indexOf(item);
      if (idx !== -1) this.switchTo(idx);
    });

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
      document.getElementById('step-redaction')!.classList.add('active');
      document.getElementById('step-preview')!.classList.add('active');
      document.getElementById('step-export')!.classList.add('active');
    }

    // Show compact drop zone when files are loaded
    document.getElementById('step-load')!.classList.add('has-files');

    this.updateLoadedSummary();
    this.updateFileNav();

    if (isVideo) {
      const player = new VideoPlayer(canvas, this.detectStatusInline);
      item.player = player;
      (window as unknown as Record<string, unknown>).__activePlayer = player;

      player.onLibavFallback = () => {
        item.usesLibav = true;
        if (this.store.items[this.store.activeIndex] === item) this.libavWarningEl.hidden = false;
      };

      // Show detection result summary when this player's frame is detected.
      // Only update UI if this item is the active one.
      player.onDetection = (dets) => {
        if (this.store.items[this.store.activeIndex] === item) this.onShowDetectionResult(dets);
      };

      player
        .load(file)
        .then(async () => {
          item.loaded = true;
          canvas.dataset.loaded = 'true';
          if (this.store.items[this.store.activeIndex] === item) this.updatePreviewAspectRatio();
          this.updateFileListMeta(item);
          const saved = await loadTrim(`${file.name}|${file.size}`);
          if (saved && item.player) {
            const dur = item.player.duration;
            item.trimStart = Math.max(0, Math.min(saved.start, dur));
            item.trimEnd = Math.max(item.trimStart, Math.min(saved.end, dur));
          }
          if (this.store.items[this.store.activeIndex] === item) this.playback.setupTrimSlider(item);
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
          if (this.store.items[this.store.activeIndex] === item) this.updatePreviewAspectRatio();
          this.updateFileListMeta(item);
          const ctx = canvas.getContext('2d')!;
          const key = await makeImageKey(file, canvas.width, canvas.height);
          const cached = await getCachedDetections(key);
          if (cached !== null) {
            const filtered = applyFilters(cached, getConfig().minConfidence, getConfig().enabledLabels);
            await applyDetections(ctx, filtered, getConfig().drawMode, getConfig().solidColor, getConfig().expansionFraction);
            if (this.store.items[this.store.activeIndex] === item) {
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
                const filtered = applyFilters(dets, getConfig().minConfidence, getConfig().enabledLabels);
                applyDetections(ctx, filtered, getConfig().drawMode, getConfig().solidColor, getConfig().expansionFraction)
                  .then(() => {
                    if (this.store.items[this.store.activeIndex] === item) {
                      this.onShowDetectionResult(filtered);
                    } else {
                      this.clearExamplesLoading();
                    }
                  })
                  .catch((err) => console.error('[fileManager] applyDetections failed:', err));
              },
              (err) => {
                if (this.store.items[this.store.activeIndex] === item) {
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

    if (switchToFile) {
      this.switchTo(this.store.items.length - 1);
    } else {
      // switchTo calls updateBtnState; call it here when not switching so labels stay current.
      this.exportManager.updateBtnState();
    }
  }

  removeFile(item: MediaItem): void {
    const index = this.store.items.indexOf(item);
    if (index === -1) return;

    // Dispose video resources
    item.player?.dispose();

    // Remove DOM elements
    item.wrapper.remove();
    item.fileListRow.remove();

    // Remove from store
    this.store.items.splice(index, 1);

    const remaining = this.store.items.length;

    if (remaining === 0) {
      document.getElementById('step-redaction')!.classList.remove('active');
      document.getElementById('step-preview')!.classList.remove('active');
      document.getElementById('step-export')!.classList.remove('active');
      document.getElementById('step-load')!.classList.remove('has-files');
      this.store.activeIndex = -1;
      this.previewArea.style.aspectRatio = '';
      this.updateAudioSettingVisibility();
      this.updateLoadedSummary();
      this.updateFileNav();
      this.exportManager.updateBtnState();
      return;
    }

    // Determine new active index
    let newActive = this.store.activeIndex;
    if (index < newActive) {
      newActive--;
    } else if (index === newActive) {
      newActive = Math.min(index, remaining - 1);
    }

    this.store.activeIndex = -1; // reset so switchTo works cleanly
    this.switchTo(newActive);
    this.updateAudioSettingVisibility();
    this.updateLoadedSummary();
  }

  switchTo(index: number): void {
    if (this.store.activeIndex >= 0) {
      this.store.items[this.store.activeIndex].wrapper.classList.remove('active');
      this.store.items[this.store.activeIndex].fileListRow.classList.remove('active-file');
    }
    this.store.activeIndex = index;

    const item = this.store.items[index];
    item.wrapper.classList.add('active');
    item.fileListRow.classList.add('active-file');

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
