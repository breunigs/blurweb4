// Register custom decoders before anything else so mediabunny sees them.
import './hevcDecoder';      // libav.js WASM fallback for HEVC (always)
import './softwareDecoder';  // prefer-software WebCodecs wrapper for AVC/VP9

import { App } from './app';

const app = new App();
app.init();
