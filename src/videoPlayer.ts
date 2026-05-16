import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import {
  getCachedDetections, scheduleInference, applyDetections,
  makeVideoKey, getAverageInferenceMs,
} from './detector';
import { getConfig } from './config';

function detStatusText(): string {
  const avg = getAverageInferenceMs();
  return avg === null ? ' detecting…' : ` detecting… (~${(avg / 1000).toFixed(1)}s per frame)`;
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

  playing = false;
  currentTime = 0;  // seconds
  duration = 0;     // seconds

  onTimeUpdate: ((time: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, statusEl: HTMLElement) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d')!;
    this.statusEl = statusEl;
  }

  async load(file: File): Promise<void> {
    this.dispose();
    this.file = file;

    this.input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in file');

    const metaDuration = await this.input.getDurationFromMetadata([track]);
    this.duration = metaDuration ?? 0;

    this.sink = new VideoSampleSink(track);

    const firstSample = await this.sink.getSample(0);
    if (firstSample) {
      this.canvas.width  = firstSample.displayWidth;
      this.canvas.height = firstSample.displayHeight;
      firstSample.draw(this.ctx, 0, 0);
      this.currentTime = firstSample.timestamp;

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.hidden = true;

      const key = makeVideoKey(this.file, this.canvas.width, this.canvas.height, firstSample.microsecondTimestamp);
      firstSample.close();

      const cached = await getCachedDetections(key);
      if (gen !== this.inferenceGen) return;
      if (cached !== null) {
        applyDetections(this.ctx, cached, getConfig().drawMode);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.hidden = false;
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.hidden = true;
          applyDetections(this.ctx, dets, getConfig().drawMode);
        });
      }
    }
  }

  async seekTo(time: number): Promise<void> {
    if (!this.sink || !this.file) return;
    const sample = await this.sink.getSample(time);
    if (sample) {
      this.canvas.width  = sample.displayWidth;
      this.canvas.height = sample.displayHeight;
      sample.draw(this.ctx, 0, 0);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.hidden = true;

      const key = makeVideoKey(this.file, this.canvas.width, this.canvas.height, sample.microsecondTimestamp);
      sample.close();

      const cached = await getCachedDetections(key);
      if (gen !== this.inferenceGen) return;
      if (cached !== null) {
        applyDetections(this.ctx, cached, getConfig().drawMode);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.hidden = false;
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.hidden = true;
          applyDetections(this.ctx, dets, getConfig().drawMode);
        });
      }
    }
  }

  async play(): Promise<void> {
    if (this.playing || !this.sink || !this.file) return;
    this.playing = true;

    const wallStart  = performance.now();
    const mediaStart = this.currentTime;

    for await (const sample of this.sink.samples(this.currentTime)) {
      if (!this.playing) { sample.close(); break; }

      const targetWall = wallStart + (sample.timestamp - mediaStart) * 1000;
      const delay = targetWall - performance.now();
      if (delay > 16) await new Promise<void>(resolve => setTimeout(resolve, delay - 8));

      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      if (!this.playing) { sample.close(); break; }

      sample.draw(this.ctx, 0, 0);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);
      this.canvas.dispatchEvent(new CustomEvent('videoframe', { detail: { timestamp: this.currentTime } }));

      this.inferenceGen++;
      const gen = this.inferenceGen;
      this.statusEl.hidden = true;

      const key = makeVideoKey(this.file, this.canvas.width, this.canvas.height, sample.microsecondTimestamp);
      sample.close();

      const cached = await getCachedDetections(key);
      if (gen !== this.inferenceGen || !this.playing) continue;
      if (cached !== null) {
        applyDetections(this.ctx, cached, getConfig().drawMode);
      } else {
        this.statusEl.textContent = detStatusText();
        this.statusEl.hidden = false;
        scheduleInference(this.canvas, key, (dets) => {
          if (this.inferenceGen !== gen) return;
          this.statusEl.hidden = true;
          applyDetections(this.ctx, dets, getConfig().drawMode);
        });
      }
    }

    if (this.playing) {
      this.playing = false;
      this.onEnd?.();
    }
  }

  pause(): void { this.playing = false; }

  dispose(): void {
    this.playing = false;
    this.statusEl.hidden = true;
    this.input?.dispose();
    this.input = null;
    this.sink  = null;
    this.file  = null;
  }
}
