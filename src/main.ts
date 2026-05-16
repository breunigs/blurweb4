// Patch console first so all subsequent logs are captured in the debug buffer.
import './debugLog';

// Register custom decoders before anything else so mediabunny sees them.
import './hevcDecoder';      // libav.js WASM fallback for HEVC (always)
import './softwareDecoder';  // platform-aware WebCodecs wrapper for AVC/VP9/AV1

import { App } from './app';

const app = new App();
app.init();
