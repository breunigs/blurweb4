import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import {
  getCachedDetections,
  scheduleInference,
  makeVideoKey,
  getAverageInferenceMs,
  applyFilters,
  type Detection,
} from './detector';
import { applyDetections } from './detectionDrawer';
import { drawSample, isHdrSample } from './hdrToneMapper';
import { getConfig } from './config';
import { t, tpl } from './i18n';

function detStatusText(): string {
  const avg = getAverageInferenceMs();
  return avg === null ? t('detecting_plain') : tpl('detecting_timed', { t: (avg / 1000).toFixed(1) });
}

export class VideoPlayer {
  private input: Input | null = null;
  private sink: VideoSampleSink | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private statusEl: HTMLElement;
  private file: File | null = null;
  /** Incremented on every new frame draw; callbacks check against their captured value. */
  private inferenceGen = 0;
  /**
   * Incremented each time seekTo() is called. Any in-flight seekTo() that
   * finds a newer generation aborts before drawing — the seek result is
   * discarded because a more recent seek has already superseded it.
   */
  private seekGen = 0;

  playing = false;
  currentTime = 0; // seconds
  duration = 0; // seconds

  /** Whether HDR tone-mapping is applied when drawing frames. */
  toneMappingEnabled = false;
  /** Fired once when the first HDR frame is detected (transfer=hlg/pq or bt2020 primaries). */
  onHdrDetected: (() => void) | null = null;
  private _hdrDetected = false;

  onTimeUpdate: ((time: number) => void) | null = null;
  onEnd: (() => void) | null = null;
  onDetection: ((dets: Detection[]) => void) | null = null;
  onLibavFallback: ((codec: string) => void) | null = null;

  private readonly libavHandler = (e: Event) => {
    this.onLibavFallback?.((e as CustomEvent<string>).detail);
  };

  constructor(canvas: HTMLCanvasElement, statusEl: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.statusEl = statusEl;
  }

  /** Set tone-mapping on/off and redraw the current frame. */
  setToneMapping(enabled: boolean): void {
    this.toneMappingEnabled = enabled;
    if (this.sink && this.currentTime >= 0) {
      void this.seekTo(this.currentTime);
    }
  }

  private drawFrame(sample: VideoSample): void {
    if (!this._hdrDetected && isHdrSample(sample)) {
      this._hdrDetected = true;
      this.onHdrDetected?.();
    }
    drawSample(sample, this.ctx, this.toneMappingEnabled);
  }

  private applyAndNotify(dets: Detection[]): void {
    const filtered = applyFilters(dets, getConfig().minConfidence, getConfig().enabledLabels);
    applyDetections(this.ctx, filtered, getConfig().drawMode, getConfig().solidColor, getConfig().expansionFraction)
      .then(() => this.onDetection?.(filtered))
      .catch((err) => console.error('[videoPlayer] applyDetections failed:', err));
  }

  async load(file: File): Promise<void> {
    this.dispose();
    window.addEventListener('libavfallback', this.libavHandler);
    this.file = file;

    this.input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in file');

    const metaDuration = await this.input.getDurationFromMetadata([track]);
    this.duration = metaDuration ?? 0;

    this.sink = new VideoSampleSink(track);

    const firstSample = await this.sink.getSample(0);
    if (firstSample) {
      this.canvas.width = firstSample.displayWidth;
      this.canvas.height = firstSample.displayHeight;
      this.drawFrame(firstSample);
      this.currentTime = firstSample.timestamp;

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.classList.remove('visible');

      const key = await makeVideoKey(this.file, this.canvas.width, this.canvas.height, firstSample.microsecondTimestamp);
      firstSample.close();

      const cached = await getCachedDetections(key);
      if (gen !== this.inferenceGen) return;
      if (cached !== null) {
        this.applyAndNotify(cached);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.classList.add('visible');
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.classList.remove('visible');
          this.applyAndNotify(dets);
        });
      }
    }
  }

  /**
   * Seek to `time` and draw the frame. Returns true if the seek completed
   * and the frame was drawn; false if it was superseded by a newer seekTo().
   */
  async seekTo(time: number): Promise<boolean> {
    if (!this.sink || !this.file) return false;

    this.seekGen++;
    const myGen = this.seekGen;

    const t0 = performance.now();
    const sample = await this.sink.getSample(time);
    console.log(
      `[videoPlayer] getSample(${time.toFixed(3)}s) ${(performance.now() - t0).toFixed(1)}ms${myGen !== this.seekGen ? ' (superseded)' : ''}`,
    );

    // If another seekTo() was called while we awaited, discard this result.
    if (myGen !== this.seekGen) {
      sample?.close();
      return false;
    }

    if (sample) {
      this.canvas.width = sample.displayWidth;
      this.canvas.height = sample.displayHeight;
      this.drawFrame(sample);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.classList.remove('visible');

      const key = await makeVideoKey(this.file, this.canvas.width, this.canvas.height, sample.microsecondTimestamp);
      sample.close();

      const tCacheStart = performance.now();
      const cached = await getCachedDetections(key);
      console.log(
        `[videoPlayer] getCachedDetections ${(performance.now() - tCacheStart).toFixed(1)}ms hit=${cached !== null}`,
      );
      if (gen !== this.inferenceGen) return true; // frame was drawn even if inference skipped
      if (cached !== null) {
        this.applyAndNotify(cached);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.classList.add('visible');
        console.log(`[videoPlayer] scheduleInference key="${key}"`);
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.classList.remove('visible');
          this.applyAndNotify(dets);
        });
      }
    }
    return true;
  }

  async play(): Promise<void> {
    if (this.playing || !this.sink || !this.file) return;
    this.playing = true;

    const wallStart = performance.now();
    const mediaStart = this.currentTime;

    for await (const sample of this.sink.samples(this.currentTime)) {
      if (!this.playing) {
        sample.close();
        break;
      }

      const targetWall = wallStart + (sample.timestamp - mediaStart) * 1000;
      const delay = targetWall - performance.now();
      if (delay > 16) await new Promise<void>((resolve) => setTimeout(resolve, delay - 8));

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      if (!this.playing) {
        sample.close();
        break;
      }

      this.drawFrame(sample);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);
      this.canvas.dispatchEvent(new CustomEvent('videoframe', { detail: { timestamp: this.currentTime } }));

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.classList.remove('visible');

      const key = await makeVideoKey(this.file, this.canvas.width, this.canvas.height, sample.microsecondTimestamp);
      sample.close();

      const cached = await getCachedDetections(key);
      if (gen !== this.inferenceGen || !this.playing) continue;
      if (cached !== null) {
        this.applyAndNotify(cached);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.classList.add('visible');
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.classList.remove('visible');
          this.applyAndNotify(dets);
        });
      }
    }

    if (this.playing) {
      this.playing = false;
      this.onEnd?.();
    }
  }

  pause(): void {
    this.playing = false;
  }

  dispose(): void {
    this.playing = false;
    this.seekGen++; // invalidate any in-flight seek
    this.statusEl.classList.remove('visible');
    window.removeEventListener('libavfallback', this.libavHandler);
    this.input?.dispose();
    this.input = null;
    this.sink = null;
    this.file = null;
    this._hdrDetected = false;
  }
}
