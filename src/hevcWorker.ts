/**
 * Web Worker — runs libav.js HEVC WASM off the main thread.
 *
 * Protocol (messages are strictly sequential — next message only sent after
 * the previous response is received):
 *
 *  Main → Worker  { type:'init',   width, height, extradata? }
 *  Worker → Main  { type:'ok' }
 *
 *  Main → Worker  { type:'decode', data:Uint8Array, pts:number, flags:number }
 *  Worker → Main  { type:'frames', frames:RawFrame[] }   (data buffers transferred)
 *
 *  Main → Worker  { type:'flush' }
 *  Worker → Main  { type:'frames', frames:RawFrame[] }   (data buffers transferred)
 *
 *  Main → Worker  { type:'close' }
 *  Worker → Main  { type:'ok' }
 *
 *  Worker → Main  { type:'error', message:string }       (any of the above fail)
 */

const LIBAV_MJS = new URL('../vendor/libav-hevc/libav-6.8.8.0-hevc-aac.wasm.mjs', import.meta.url).href;
const AVMEDIA_TYPE_VIDEO = 0;
const AV_CODEC_ID_HEVC   = 173;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let libav: any = null;
let c = 0, pkt = 0, frame = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFrames(rawFrames: any[]): { frames: any[]; transfers: ArrayBuffer[] } {
  const transfers: ArrayBuffer[] = [];
  for (const f of rawFrames) {
    if (!(f.data instanceof Uint8Array)) continue;
    // If data is a view into WASM linear memory, copy it out first so the
    // buffer can be safely transferred without detaching the WASM heap.
    if (libav?.HEAPU8 && f.data.buffer === libav.HEAPU8.buffer) {
      f.data = f.data.slice();
    }
    transfers.push(f.data.buffer);
  }
  return { frames: rawFrames, transfers };
}

self.addEventListener('message', (e: MessageEvent) => {
  void (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = e.data as Record<string, any>;
    try {
      if (msg.type === 'init') {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const { default: LibAVFactory } = await (new Function('u', 'return import(u)'))(LIBAV_MJS) as {
          default: (opts?: object) => Promise<unknown>;
        };
        libav = await LibAVFactory();

        [, c, pkt, frame] = await libav.ff_init_decoder('hevc', {
          codecpar: {
            codec_type: AVMEDIA_TYPE_VIDEO,
            codec_id:   AV_CODEC_ID_HEVC,
            format:     -1,
            width:      msg.width  as number,
            height:     msg.height as number,
            extradata:  msg.extradata as Uint8Array | undefined,
          },
          time_base: [1, 1_000_000],
        }) as [number, number, number, number];

        self.postMessage({ type: 'ok' });

      } else if (msg.type === 'decode') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawFrames: any[] = await libav.ff_decode_multi(
          c, pkt, frame,
          [{
            data:          msg.data as Uint8Array,
            pts:           msg.pts  as number,
            dts:           msg.pts  as number,
            flags:         msg.flags as number,
            time_base_num: 1,
            time_base_den: 1_000_000,
          }],
          { copyoutFrame: 'video_packed' },
        );
        const { frames, transfers } = extractFrames(rawFrames);
        self.postMessage({ type: 'frames', frames }, { transfer: transfers });

      } else if (msg.type === 'flush') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawFrames: any[] = await libav.ff_decode_multi(
          c, pkt, frame, [],
          { fin: true, copyoutFrame: 'video_packed' },
        );
        const { frames, transfers } = extractFrames(rawFrames);
        self.postMessage({ type: 'frames', frames }, { transfer: transfers });

      } else if (msg.type === 'close') {
        if (libav) {
          await libav.ff_free_decoder(c, pkt, frame);
          libav = null;
          c = pkt = frame = 0;
        }
        self.postMessage({ type: 'ok' });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  })();
});
