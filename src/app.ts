import { renderImage } from './imageRenderer';
import { VideoPlayer } from './videoPlayer';
import { runBatch } from './batchExporter';
import type { ExportItem } from './batchExporter';
import {
  getCachedDetections, scheduleInference, drawDetections,
  makeImageKey, getAverageInferenceMs,
} from './detector';

interface MediaItem {
  name: string;
  isVideo: boolean;
  file: File;
  tab: HTMLButtonElement;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  /** Status bar element showing "detecting…" while inference is pending. */
  statusEl: HTMLElement;
  player?: VideoPlayer;
  loaded: boolean;
  exported: boolean;
  /** Video-only: progress bar track element (hidden until export). */
  progressTrack: HTMLElement | null;
  /** Video-only: progress bar fill element. */
  progressFill: HTMLElement | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class App {
  private items: MediaItem[] = [];
  private activeIndex = -1;
  private seeking = false;
  private exporting = false;

  private dropZone!: HTMLElement;
  private tabBar!: HTMLElement;
  private previewArea!: HTMLElement;
  private emptyState!: HTMLElement;
  private controls!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private seekBar!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private exportBtn!: HTMLButtonElement;
  private globalProgress!: HTMLElement;
  private globalProgressFill!: HTMLElement;

  init(): void {
    this.dropZone          = document.getElementById('drop-zone')!;
    this.tabBar            = document.getElementById('tab-bar')!;
    this.previewArea       = document.getElementById('preview-area')!;
    this.emptyState        = document.getElementById('empty-state')!;
    this.controls          = document.getElementById('controls')!;
    this.playBtn           = document.getElementById('play-btn') as HTMLButtonElement;
    this.seekBar           = document.getElementById('seek-bar') as HTMLInputElement;
    this.timeDisplay       = document.getElementById('time-display')!;
    this.fileInput         = document.getElementById('file-input') as HTMLInputElement;
    this.exportBtn         = document.getElementById('export-btn') as HTMLButtonElement;
    this.globalProgress    = document.getElementById('global-progress')!;
    this.globalProgressFill = document.getElementById('global-progress-fill')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files?.length) this.addFiles(files);
    });

    this.dropZone.addEventListener('dragenter', () =>
      this.dropZone.classList.add('drag-over'));
    this.dropZone.addEventListener('dragleave', e => {
      if (!this.dropZone.contains(e.relatedTarget as Node))
        this.dropZone.classList.remove('drag-over');
    });

    document.getElementById('pick-btn')!.addEventListener('click', () =>
      this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) this.addFiles(this.fileInput.files);
      this.fileInput.value = '';
    });

    this.exportBtn.addEventListener('click', () => this.startExport());

    // Play / pause
    this.playBtn.addEventListener('click', () => {
      const item = this.items[this.activeIndex];
      if (!item?.player) return;
      if (item.player.playing) {
        item.player.pause();
        this.playBtn.textContent = '▶';
      } else {
        this.playBtn.textContent = '⏸';
        item.player.play().then(() => {
          if (!item.player!.playing) this.playBtn.textContent = '▶';
        });
      }
    });

    // Seek
    this.seekBar.addEventListener('mousedown', () => { this.seeking = true; });
    this.seekBar.addEventListener('touchstart', () => { this.seeking = true; });
    this.seekBar.addEventListener('change', () => {
      this.seeking = false;
      const item = this.items[this.activeIndex];
      if (!item?.player) return;
      const time = (Number(this.seekBar.value) / 1000) * item.player.duration;
      const wasPlaying = item.player.playing;
      if (wasPlaying) item.player.pause();
      item.player.seekTo(time).then(() => {
        if (wasPlaying) {
          this.playBtn.textContent = '⏸';
          item.player!.play().then(() => {
            if (!item.player!.playing) this.playBtn.textContent = '▶';
          });
        }
      });
    });
  }

  private addFiles(files: FileList): void {
    for (const file of files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        this.addFile(file);
      }
    }
  }

  private addFile(file: File): void {
    const isVideo = file.type.startsWith('video/');
    const index = this.items.length;

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.textContent = file.name;
    tab.addEventListener('click', () => this.switchTo(index));
    this.tabBar.appendChild(tab);

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);

    // Detection status bar — shown while inference is in progress.
    const statusEl = document.createElement('div');
    statusEl.className = 'detect-status';
    statusEl.hidden = true;
    wrapper.appendChild(statusEl);

    // Per-video progress bar (hidden until export starts)
    let progressTrack: HTMLElement | null = null;
    let progressFill: HTMLElement | null = null;
    if (isVideo) {
      progressTrack = document.createElement('div');
      progressTrack.className = 'file-progress';
      progressTrack.hidden = true;
      progressFill = document.createElement('div');
      progressFill.className = 'file-progress-fill';
      progressTrack.appendChild(progressFill);
      wrapper.appendChild(progressTrack);
    }

    this.previewArea.appendChild(wrapper);

    const item: MediaItem = {
      name: file.name, isVideo, file, tab, wrapper, canvas, statusEl,
      loaded: false, exported: false, progressTrack, progressFill,
    };
    this.items.push(item);

    this.emptyState.style.display = 'none';
    this.exportBtn.disabled = false;

    if (isVideo) {
      const player = new VideoPlayer(canvas, statusEl);
      item.player = player;

      player.onTimeUpdate = () => {
        if (this.activeIndex !== index || this.seeking) return;
        this.refreshControls(player);
      };
      player.onEnd = () => {
        if (this.activeIndex === index) this.playBtn.textContent = '▶';
      };

      player.load(file).then(() => {
        item.loaded = true;
        canvas.dataset.loaded = 'true';
        if (this.activeIndex === index) this.refreshControls(player);
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
          drawDetections(ctx, cached);
        } else {
          const avg = getAverageInferenceMs();
          statusEl.textContent = avg === null
            ? ' detecting…'
            : ` detecting… (~${(avg / 1000).toFixed(1)}s per frame)`;
          statusEl.hidden = false;
          scheduleInference(canvas, key, detections => {
            statusEl.hidden = true;
            drawDetections(ctx, detections);
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

  private switchTo(index: number): void {
    if (this.activeIndex >= 0) {
      const prev = this.items[this.activeIndex];
      prev.tab.classList.remove('active');
      prev.wrapper.classList.remove('active');
      if (prev.player?.playing) {
        prev.player.pause();
        this.playBtn.textContent = '▶';
      }
    }

    this.activeIndex = index;
    const item = this.items[index];
    item.tab.classList.add('active');
    item.wrapper.classList.add('active');

    if (item.isVideo) {
      this.controls.classList.add('visible');
      if (item.player) this.refreshControls(item.player);
    } else {
      this.controls.classList.remove('visible');
    }
  }

  private refreshControls(player: VideoPlayer): void {
    const pct = player.duration > 0
      ? Math.round((player.currentTime / player.duration) * 1000)
      : 0;
    this.seekBar.value = String(pct);
    this.timeDisplay.textContent =
      `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    this.playBtn.textContent = player.playing ? '⏸' : '▶';
  }

  private async startExport(): Promise<void> {
    if (this.exporting || this.items.length === 0) return;
    this.exporting = true;
    this.exportBtn.disabled = true;
    this.exportBtn.textContent = 'Exporting…';

    // Only export items that haven't been exported yet in a previous batch.
    const pending = this.items.filter(it => !it.exported);
    const showGlobal = pending.length > 1;
    if (showGlobal) {
      this.globalProgress.hidden = false;
      this.globalProgressFill.style.width = '0%';
    }

    if (pending.length === 0) {
      this.exporting = false;
      this.exportBtn.disabled = false;
      this.exportBtn.textContent = 'Export';
      return;
    }

    const exportItems: ExportItem[] = pending.map(it => ({
      name:          it.name,
      isVideo:       it.isVideo,
      canvas:        it.isVideo ? undefined : it.canvas,
      file:          it.isVideo ? it.file : undefined,
      progressFill:  it.progressFill,
      progressTrack: it.progressTrack,
    }));

    await runBatch(exportItems, {
      onFileStart: () => {},
      onFileEnd: (index, error) => {
        if (!error) pending[index].exported = true;
      },
      onGlobalProgress: (completed, total) => {
        if (showGlobal) {
          this.globalProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;
        }
      },
    });

    this.exportBtn.textContent = 'Export';
    this.exportBtn.disabled = false;
    this.exporting = false;

    if (showGlobal) {
      setTimeout(() => {
        this.globalProgress.hidden = true;
        this.globalProgressFill.style.width = '0%';
      }, 1500);
    }
  }
}
