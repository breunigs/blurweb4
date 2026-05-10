import { renderImage } from './imageRenderer';
import { VideoPlayer } from './videoPlayer';

interface MediaItem {
  name: string;
  isVideo: boolean;
  tab: HTMLButtonElement;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  player?: VideoPlayer;
  loaded: boolean;
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

  private dropZone!: HTMLElement;
  private tabBar!: HTMLElement;
  private previewArea!: HTMLElement;
  private emptyState!: HTMLElement;
  private controls!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private seekBar!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private fileInput!: HTMLInputElement;

  init(): void {
    this.dropZone   = document.getElementById('drop-zone')!;
    this.tabBar     = document.getElementById('tab-bar')!;
    this.previewArea = document.getElementById('preview-area')!;
    this.emptyState = document.getElementById('empty-state')!;
    this.controls   = document.getElementById('controls')!;
    this.playBtn    = document.getElementById('play-btn') as HTMLButtonElement;
    this.seekBar    = document.getElementById('seek-bar') as HTMLInputElement;
    this.timeDisplay = document.getElementById('time-display')!;
    this.fileInput  = document.getElementById('file-input') as HTMLInputElement;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Drag-over anywhere on the page
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

    // File picker
    document.getElementById('pick-btn')!.addEventListener('click', () =>
      this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) this.addFiles(this.fileInput.files);
      this.fileInput.value = '';
    });

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

    // Tab button
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.textContent = file.name;
    tab.addEventListener('click', () => this.switchTo(index));
    this.tabBar.appendChild(tab);

    // Canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    this.previewArea.appendChild(wrapper);

    const item: MediaItem = { name: file.name, isVideo, tab, wrapper, canvas, loaded: false };
    this.items.push(item);

    this.emptyState.style.display = 'none';

    // Load
    if (isVideo) {
      const player = new VideoPlayer(canvas);
      item.player = player;

      player.onTimeUpdate = (time) => {
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
      renderImage(file, canvas).then(() => {
        item.loaded = true;
        canvas.dataset.loaded = 'true';
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
}
