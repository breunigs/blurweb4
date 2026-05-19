import { saveTrim } from './trimStorage';
import { tpl } from './i18n';
import { type MediaItem, type ItemStore, formatTime, debounce } from './types';

export class PlaybackController {
  private readonly debouncedSeekStart = debounce((item: MediaItem, sec: number) => {
    void this.seekAndUpdate(item, sec);
  }, 120);

  readonly debouncedSeekEnd = debounce((item: MediaItem, sec: number) => {
    void this.seekAndUpdate(item, sec);
  }, 120);

  constructor(
    private readonly store: ItemStore,
    private readonly previewArea: HTMLElement,
    private readonly trimSection: HTMLElement,
    private readonly trimStartInput: HTMLInputElement,
    private readonly trimEndInput: HTMLInputElement,
    private readonly trimTrackFill: HTMLElement,
    private readonly trimStartLabel: HTMLElement,
    private readonly trimEndLabel: HTMLElement,
    private readonly trimDurationLabel: HTMLElement,
    private readonly onTrimChanged: (item: MediaItem) => void,
  ) {
    trimStartInput.addEventListener('pointerdown', () => this.setActiveThumb('start'));
    trimEndInput.addEventListener('pointerdown', () => this.setActiveThumb('end'));
    trimStartInput.addEventListener('input', () => this.onTrimStartInput());
    trimEndInput.addEventListener('input', () => this.onTrimEndInput());
  }

  /** Called when the active item changes (file switch or first load). */
  onActiveChanged(item: MediaItem | undefined): void {
    if (!item?.isVideo) {
      this.trimSection.classList.remove('visible');
      return;
    }
    this.trimSection.classList.add('visible');
    if (item.loaded) this.setupTrimSlider(item);
  }

  setupTrimSlider(item: MediaItem): void {
    const dur = item.player!.duration;
    const STEPS = 1000;
    this.trimStartInput.value = String(Math.round(((item.trimStart ?? 0) / dur) * STEPS));
    this.trimEndInput.value = String(Math.round(((item.trimEnd ?? dur) / dur) * STEPS));
    this.updateTrimFill();
    this.updateTrimLabels(item);
    // Default: start thumb is active (highlighted).
    this.setActiveThumb('start');
    this.setCanvasStale(false);
  }

  updateTrimFill(): void {
    const s = Number(this.trimStartInput.value);
    const e = Number(this.trimEndInput.value);
    const max = Number(this.trimStartInput.max);
    this.trimTrackFill.style.left = `${(s / max) * 100}%`;
    this.trimTrackFill.style.width = `${((e - s) / max) * 100}%`;
  }

  updateTrimLabels(item: MediaItem): void {
    const dur = item.player!.duration;
    const s = item.trimStart ?? 0;
    const e = item.trimEnd ?? dur;
    this.trimStartLabel.textContent = formatTime(s);
    this.trimEndLabel.textContent = formatTime(e);
    this.trimDurationLabel.textContent = tpl('selected', { s: `${(e - s).toFixed(2)}s` });
  }

  setActiveThumb(which: 'start' | 'end'): void {
    this.trimStartInput.classList.toggle('active-thumb', which === 'start');
    this.trimEndInput.classList.toggle('active-thumb', which === 'end');
  }

  setCanvasStale(stale: boolean): void {
    this.previewArea.classList.toggle('stale', stale);
  }

  async seekAndUpdate(item: MediaItem, sec: number): Promise<void> {
    this.setCanvasStale(true);
    const drawn = await item.player!.seekTo(sec);
    // Only clear stale if this seek actually drew (not superseded by a newer one).
    if (drawn) this.setCanvasStale(false);
  }

  applyTrimStart(item: MediaItem, sec: number): void {
    item.trimStart = sec;
    saveTrim(`${item.file.name}|${item.file.size}`, sec, item.trimEnd ?? item.player!.duration);
    const steps = Number(this.trimStartInput.max);
    const dur = item.player!.duration;
    this.trimStartInput.value = String(Math.round((sec / dur) * steps));
    this.updateTrimFill();
    this.updateTrimLabels(item);
    this.setActiveThumb('start');
    this.debouncedSeekStart(item, sec);
  }

  applyTrimEnd(item: MediaItem, sec: number): void {
    item.trimEnd = sec;
    saveTrim(`${item.file.name}|${item.file.size}`, item.trimStart ?? 0, sec);
    const dur = item.player!.duration;
    const steps = Number(this.trimEndInput.max);
    this.trimEndInput.value = String(Math.round((sec / dur) * steps));
    this.updateTrimFill();
    this.updateTrimLabels(item);
    this.setActiveThumb('end');
    this.debouncedSeekEnd(item, sec);
  }

  private onTrimStartInput(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const max = Number(this.trimStartInput.max);
    const endVal = Number(this.trimEndInput.value);
    if (Number(this.trimStartInput.value) >= endVal) this.trimStartInput.value = String(Math.max(0, endVal - 1));
    item.trimStart = (Number(this.trimStartInput.value) / max) * item.player.duration;
    saveTrim(`${item.file.name}|${item.file.size}`, item.trimStart, item.trimEnd ?? item.player.duration);
    item.exported = false;
    this.onTrimChanged(item);
    this.updateTrimFill();
    this.updateTrimLabels(item);
    // Mark stale immediately; debounced seek fires after 120 ms of silence.
    this.setCanvasStale(true);
    this.debouncedSeekStart(item, item.trimStart);
  }

  private onTrimEndInput(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const max = Number(this.trimEndInput.max);
    const startVal = Number(this.trimStartInput.value);
    if (Number(this.trimEndInput.value) <= startVal) this.trimEndInput.value = String(Math.min(max, startVal + 1));
    item.trimEnd = (Number(this.trimEndInput.value) / max) * item.player.duration;
    saveTrim(`${item.file.name}|${item.file.size}`, item.trimStart ?? 0, item.trimEnd);
    item.exported = false;
    this.onTrimChanged(item);
    this.updateTrimFill();
    this.updateTrimLabels(item);
    this.setCanvasStale(true);
    this.debouncedSeekEnd(item, item.trimEnd);
  }
}
