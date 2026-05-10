import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';

export class VideoPlayer {
  private input: Input | null = null;
  private sink: VideoSampleSink | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  playing = false;
  currentTime = 0;  // seconds
  duration = 0;     // seconds

  onTimeUpdate: ((time: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  async load(file: File): Promise<void> {
    this.dispose();

    this.input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in file');

    // Get duration from metadata (fast path)
    const metaDuration = await this.input.getDurationFromMetadata([track]);
    this.duration = metaDuration ?? 0;

    this.sink = new VideoSampleSink(track);

    // Decode and show the first frame to get canvas dimensions
    const firstSample = await this.sink.getSample(0);
    if (firstSample) {
      this.canvas.width = firstSample.displayWidth;
      this.canvas.height = firstSample.displayHeight;
      firstSample.draw(this.ctx, 0, 0);
      this.currentTime = firstSample.timestamp;
      firstSample.close();
    }
  }

  async seekTo(time: number): Promise<void> {
    if (!this.sink) return;
    const sample = await this.sink.getSample(time);
    if (sample) {
      this.canvas.width = sample.displayWidth;
      this.canvas.height = sample.displayHeight;
      sample.draw(this.ctx, 0, 0);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);
      sample.close();
    }
  }

  async play(): Promise<void> {
    if (this.playing || !this.sink) return;
    this.playing = true;

    const wallStart = performance.now();
    const mediaStart = this.currentTime;

    for await (const sample of this.sink.samples(this.currentTime)) {
      if (!this.playing) {
        sample.close();
        break;
      }

      // sample.timestamp is in seconds
      const targetWall = wallStart + (sample.timestamp - mediaStart) * 1000;
      const delay = targetWall - performance.now();
      if (delay > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, delay));
      }

      if (!this.playing) {
        sample.close();
        break;
      }

      sample.draw(this.ctx, 0, 0);
      this.currentTime = sample.timestamp;
      this.onTimeUpdate?.(this.currentTime);
      sample.close();
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
    this.input?.dispose();
    this.input = null;
    this.sink = null;
  }
}
