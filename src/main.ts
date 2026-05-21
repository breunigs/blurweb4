// Patch console first so all subsequent logs are captured in the debug buffer.
import './debugLog';
import './hangDetector';

// Register custom decoders before anything else so mediabunny sees them.
// Registration order matters: mediabunny checks decoders in order and uses
// the first one whose supports() returns true.
import './hevcDecoder'; // libav.js WASM fallback for HEVC (always)
import './softwareDecoder'; // smart WebCodecs with hw→sw→no-preference fallback chain
import './libavVideoDecoder'; // libav.js WASM fallback for AVC/AV1 (only when all WebCodecs fail)

// Register quality-mode encoder (overrides mediabunny's realtime-latency default).
import './qualityEncoder';

import { App } from './app';

const app = new App();
app.init();
