import { saveTrim } from './trimStorage';
import { t, tpl } from './i18n';
import { type MediaItem, type ItemStore, debounce } from './types';

export class PlaybackController {
  private readonly debouncedSeek = debounce((item: MediaItem, sec: number) => {
    void this.seekAndUpdate(item, sec);
  }, 120);

  constructor(
    private readonly store: ItemStore,
    private readonly previewArea: HTMLElement,
    private readonly trimSection: HTMLElement,
    private readonly scrubberEl: HTMLInputElement,
    private readonly trimStartText: HTMLInputElement,
    private readonly trimEndText: HTMLInputElement,
    private readonly trimStartNow: HTMLButtonElement,
    private readonly trimEndNow: HTMLButtonElement,
    private readonly trimWholeVideo: HTMLButtonElement,
    private readonly trimDurationLabel: HTMLElement,
    private readonly onTrimChanged: (item: MediaItem) => void,
  ) {
    scrubberEl.addEventListener('input', () => this.onScrubberInput());
    trimStartNow.addEventListener('click', () => this.onStartNow());
    trimEndNow.addEventListener('click', () => this.onEndNow());
    trimWholeVideo.addEventListener('click', () => this.onWholeVideo());
    trimStartText.addEventListener('blur', () => this.onStartBlur());
    trimEndText.addEventListener('blur', () => this.onEndBlur());
  }

  /** Called when the active item changes (file switch or first load). */
  onActiveChanged(item: MediaItem | undefined): void {
    const titleEl = document.getElementById('step-preview-title');
    if (!item?.isVideo) {
      this.trimSection.classList.remove('visible');
      this.scrubberEl.style.background = '';
      if (titleEl) { titleEl.setAttribute('data-i18n', 'step_preview_image'); titleEl.textContent = t('step_preview_image'); }
      return;
    }
    this.trimSection.classList.add('visible');
    if (titleEl) { titleEl.setAttribute('data-i18n', 'step_preview_video'); titleEl.textContent = t('step_preview_video'); }
    if (item.loaded) this.setupTrimSlider(item);
  }

  setupTrimSlider(item: MediaItem): void {
    const dur = item.player!.duration;
    this.scrubberEl.max = String(Math.round(dur * 1000));
    const startSec = item.trimStart ?? 0;
    this.scrubberEl.value = String(Math.round(startSec * 1000));
    this.trimStartText.value = this.formatTs(startSec);
    this.trimEndText.value = this.formatTs(item.trimEnd ?? dur);
    this.updateTrimLabels(item);
    this.setCanvasStale(false);
  }

  /** Format seconds as m:ss.SSS (e.g. 0:03.250) */
  formatTs(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const sFmt = s.toFixed(3).padStart(6, '0'); // "03.250"
    return `${m}:${sFmt}`;
  }

  /** Parse [[h:]m:]ss[.SSS] → seconds, or null if invalid */
  parseTs(s: string): number | null {
    s = s.trim();
    // Match optional hours:minutes:seconds or minutes:seconds
    const m3 = /^(\d+):(\d+):(\d+(?:\.\d*)?)$/.exec(s);
    if (m3) {
      const h = parseInt(m3[1], 10);
      const min = parseInt(m3[2], 10);
      const secs = parseFloat(m3[3]);
      if (isNaN(h) || isNaN(min) || isNaN(secs)) return null;
      return h * 3600 + min * 60 + secs;
    }
    const m2 = /^(\d+):(\d+(?:\.\d*)?)$/.exec(s);
    if (m2) {
      const min = parseInt(m2[1], 10);
      const secs = parseFloat(m2[2]);
      if (isNaN(min) || isNaN(secs)) return null;
      return min * 60 + secs;
    }
    // Plain seconds
    const plain = parseFloat(s);
    if (!isNaN(plain) && plain >= 0) return plain;
    return null;
  }

  private onScrubberInput(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const dur = item.player.duration;
    const val = Number(this.scrubberEl.value);
    const max = Number(this.scrubberEl.max);
    const sec = (val / max) * dur;
    this.setCanvasStale(true);
    this.debouncedSeek(item, sec);
  }

  private onStartNow(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const dur = item.player.duration;
    const val = Number(this.scrubberEl.value);
    const max = Number(this.scrubberEl.max);
    const sec = (val / max) * dur;
    this.trimStartText.value = this.formatTs(sec);
    // Trigger blur-like commit
    this.commitTrim(item);
  }

  private onEndNow(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const dur = item.player.duration;
    const val = Number(this.scrubberEl.value);
    const max = Number(this.scrubberEl.max);
    const sec = (val / max) * dur;
    this.trimEndText.value = this.formatTs(sec);
    // Trigger blur-like commit
    this.commitTrim(item);
  }

  private onStartBlur(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const parsed = this.parseTs(this.trimStartText.value);
    if (parsed === null) {
      // Restore previous value
      this.trimStartText.value = this.formatTs(item.trimStart ?? 0);
      return;
    }
    this.trimStartText.value = this.formatTs(parsed);
    this.commitTrim(item);
  }

  private onEndBlur(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const parsed = this.parseTs(this.trimEndText.value);
    if (parsed === null) {
      // Restore previous value
      this.trimEndText.value = this.formatTs(item.trimEnd ?? item.player.duration);
      return;
    }
    this.trimEndText.value = this.formatTs(parsed);
    this.commitTrim(item);
  }

  private commitTrim(item: MediaItem): void {
    const dur = item.player!.duration;
    let startParsed = this.parseTs(this.trimStartText.value) ?? (item.trimStart ?? 0);
    let endParsed = this.parseTs(this.trimEndText.value) ?? (item.trimEnd ?? dur);

    // Clamp to duration
    startParsed = Math.max(0, Math.min(dur, startParsed));
    endParsed = Math.max(0, Math.min(dur, endParsed));

    // Swap if start > end
    if (startParsed > endParsed) {
      [startParsed, endParsed] = [endParsed, startParsed];
      this.trimStartText.value = this.formatTs(startParsed);
      this.trimEndText.value = this.formatTs(endParsed);
    }

    // Single frame?
    item.singleFrame = startParsed === endParsed;
    item.trimStart = startParsed;
    item.trimEnd = endParsed;
    item.exported = false;

    saveTrim(`${item.file.name}|${item.file.size}`, startParsed, endParsed);
    this.updateTrimLabels(item);
    this.onTrimChanged(item);
  }

  private onWholeVideo(): void {
    const item = this.store.items[this.store.activeIndex];
    if (!item?.isVideo || !item.player) return;
    const dur = item.player.duration;
    this.trimStartText.value = this.formatTs(0);
    this.trimEndText.value = this.formatTs(dur);
    this.commitTrim(item);
  }

  updateTrimLabels(item: MediaItem): void {
    const dur = item.player!.duration;
    const s = item.trimStart ?? 0;
    const e = item.trimEnd ?? dur;
    this.trimDurationLabel.textContent = tpl('selected', { s: `${(e - s).toFixed(2)}s` });
    const isTrimmed = s > 0 || Math.abs(e - dur) > 0.001;
    this.trimWholeVideo.disabled = !isTrimmed;
    this.updateScrubberHighlight(s / dur, e / dur);
  }

  private updateScrubberHighlight(startFrac: number, endFrac: number): void {
    const s = (startFrac * 100).toFixed(3);
    const e = (endFrac * 100).toFixed(3);
    const cut = 'rgba(220,38,38,0.35)';
    const track = 'var(--card2)';
    this.scrubberEl.style.background =
      `linear-gradient(to right, ${cut} 0%, ${cut} ${s}%, ${track} ${s}%, ${track} ${e}%, ${cut} ${e}%, ${cut} 100%)`;
  }

  setCanvasStale(stale: boolean): void {
    this.previewArea.classList.toggle('stale', stale);
  }

  async seekAndUpdate(item: MediaItem, sec: number): Promise<void> {
    this.setCanvasStale(true);
    const drawn = await item.player!.seekTo(sec);
    if (drawn) this.setCanvasStale(false);
  }

  applyTrimStart(item: MediaItem, sec: number): void {
    item.trimStart = sec;
    item.singleFrame = sec === (item.trimEnd ?? item.player!.duration);
    saveTrim(`${item.file.name}|${item.file.size}`, sec, item.trimEnd ?? item.player!.duration);
    this.trimStartText.value = this.formatTs(sec);
    // Update scrubber to trim start position
    const dur = item.player!.duration;
    this.scrubberEl.value = String(Math.round((sec / dur) * Number(this.scrubberEl.max)));
    this.updateTrimLabels(item);
    this.debouncedSeek(item, sec);
  }

  applyTrimEnd(item: MediaItem, sec: number): void {
    item.trimEnd = sec;
    item.singleFrame = (item.trimStart ?? 0) === sec;
    saveTrim(`${item.file.name}|${item.file.size}`, item.trimStart ?? 0, sec);
    this.trimEndText.value = this.formatTs(sec);
    // Update scrubber to trim end position
    const dur = item.player!.duration;
    this.scrubberEl.value = String(Math.round((sec / dur) * Number(this.scrubberEl.max)));
    this.updateTrimLabels(item);
    this.debouncedSeek(item, sec);
  }

  /** Update just the duration label without changing trim values (for __setTrimEndSilent compat) */
  updateTrimFill(): void {
    // No-op: fill is now handled by native range input appearance
  }
}
