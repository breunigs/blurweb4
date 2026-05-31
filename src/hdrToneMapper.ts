/**
 * HDR tone-mapping for HLG and PQ content.
 *
 * isHdrSample() detects HDR content from the sample's color space metadata.
 * drawSample() is a drop-in replacement for sample.draw(ctx, 0, 0).
 * When applyToneMapping=true and content is HDR, routes through a WebGL shader:
 * inverse OETF → OOTF → BT.2020→sRGB matrix → sRGB gamma.
 *
 * For SDR content or when applyToneMapping=false, falls through to sample.draw().
 */

import type { VideoSample } from 'mediabunny';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ── HDR detection ───────────────────────────────────────────────────────────

/**
 * Returns true if this sample carries HDR content that benefits from explicit
 * tone-mapping. Handles HLG/PQ transfer and the bt2020+null/bt709 case where
 * Firefox and Safari H.264 decoders don't surface HLG SEI metadata.
 */
export function isHdrSample(sample: VideoSample): boolean {
  const primaries = sample.colorSpace.primaries as string | null;
  const transfer = sample.colorSpace.transfer as string | null;
  if (transfer === 'hlg' || transfer === 'pq') return true;
  if (primaries === 'bt2020' && (transfer === null || transfer === 'bt709')) return true;
  return false;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Tracks which log lines have already been emitted (first-time-only messages). */
const _logged = new Set<string>();

/**
 * Draw a video sample to the given canvas context.
 * If applyToneMapping=true and the sample is HDR, routes through a WebGL shader.
 * Otherwise falls through to sample.draw(ctx, 0, 0).
 */
export function drawSample(sample: VideoSample, ctx: AnyCtx, applyToneMapping: boolean): void {
  if (!applyToneMapping || !isHdrSample(sample)) {
    sample.draw(ctx, 0, 0);
    return;
  }

  const primaries = sample.colorSpace.primaries as string | null;
  const transfer = sample.colorSpace.transfer as string | null;
  let effectiveTransfer: 'hlg' | 'pq';
  if (transfer === 'pq') {
    effectiveTransfer = 'pq';
  } else {
    effectiveTransfer = 'hlg';
    if (transfer !== 'hlg') {
      const key = `assume-hlg-${transfer ?? 'null'}-${primaries ?? 'null'}`;
      if (!_logged.has(key)) {
        _logged.add(key);
        console.warn(`[hdrToneMapper] primaries="${primaries}" transfer="${transfer ?? 'null'}" → assuming HLG`);
      }
    }
  }

  drawWithToneMapping(sample, ctx, effectiveTransfer);
}

// ── Shaders ─────────────────────────────────────────────────────────────────

// UNPACK_FLIP_Y_WEBGL=true flips the VideoFrame during upload so UV(0,0) maps
// to the bottom-left of the image (correct display orientation).
const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, aPos.y * 0.5 + 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Helpers shared by both fragment shaders.
// BT.2020→sRGB matrix is column-major (GLSL mat3 convention).
// Columns: (1.6605,-0.1246,-0.0182), (-0.5877,1.1329,-0.1006), (-0.0728,-0.0083,1.1187)
const FRAG_COMMON = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUV;

float srgbGamma(float x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

vec3 bt2020ToSrgb(vec3 c) {
  return mat3(
     1.6605, -0.1246, -0.0182,
    -0.5877,  1.1329, -0.1006,
    -0.0728, -0.0083,  1.1187
  ) * c;
}`;

// HLG: ITU-R BT.2100 inverse OETF → OOTF (γ=1.2) → BT.2020→sRGB → sRGB gamma
const FRAG_HLG = FRAG_COMMON + `

float hlgInvOETF(float x) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  return x <= 0.5 ? (x * x) / 3.0 : (exp((x - c) / a) + b) / 12.0;
}

vec3 hlgOOTF(vec3 rgb) {
  // System gamma γ=1.2 with BT.2020 luma coefficients
  float Y = dot(rgb, vec3(0.2627, 0.6780, 0.0593));
  return rgb * pow(max(Y, 1e-6), 0.2);
}

void main() {
  vec3 e    = texture2D(uTex, vUV).rgb;
  vec3 lin  = vec3(hlgInvOETF(e.r), hlgInvOETF(e.g), hlgInvOETF(e.b));
  vec3 disp = hlgOOTF(lin);
  vec3 s    = clamp(bt2020ToSrgb(disp), 0.0, 1.0);
  gl_FragColor = vec4(srgbGamma(s.r), srgbGamma(s.g), srgbGamma(s.b), 1.0);
}`;

// PQ: ST.2084 inverse EOTF → normalise to 203-nit SDR white → clip → BT.2020→sRGB → sRGB gamma
const FRAG_PQ = FRAG_COMMON + `

float pqInvEOTF(float x) {
  // Returns scene linear in [0,1] where 1.0 = 10 000 nits
  const float m1 = 0.1593017578125, m2 = 78.84375;
  const float c1 = 0.8359375,       c2 = 18.8515625, c3 = 18.6875;
  float xp = pow(max(x, 0.0), 1.0 / m2);
  return pow(max(xp - c1, 0.0) / (c2 - c3 * xp), 1.0 / m1);
}

void main() {
  vec3 e      = texture2D(uTex, vUV).rgb;
  vec3 lin    = vec3(pqInvEOTF(e.r), pqInvEOTF(e.g), pqInvEOTF(e.b));
  // Normalise so SDR diffuse white (203 nit) = 1.0; hard-clip HDR highlights
  vec3 sdrLin = clamp(lin * (10000.0 / 203.0), 0.0, 1.0);
  vec3 s      = clamp(bt2020ToSrgb(sdrLin), 0.0, 1.0);
  gl_FragColor = vec4(srgbGamma(s.r), srgbGamma(s.g), srgbGamma(s.b), 1.0);
}`;

// ── WebGL singletons ────────────────────────────────────────────────────────

let _canvas: OffscreenCanvas | null = null;
let _gl: WebGLRenderingContext | null = null;
let _programs: { hlg: WebGLProgram | null; pq: WebGLProgram | null } = { hlg: null, pq: null };
let _quad: WebGLBuffer | null = null;
let _tex: WebGLTexture | null = null;

function initGL(): WebGLRenderingContext | null {
  _canvas = new OffscreenCanvas(1, 1);

  const gl = _canvas.getContext('webgl') as WebGLRenderingContext | null;
  if (!gl) {
    console.warn('[hdrToneMapper] WebGL unavailable; HDR frames will fall back to native draw');
    return null;
  }

  _canvas.addEventListener('webglcontextlost', () => {
    console.warn('[hdrToneMapper] WebGL context lost; will reinitialise on next HDR frame');
    _gl = null;
    _programs = { hlg: null, pq: null };
    _quad = null;
    _tex = null;
  });

  function compileShader(src: string, type: number): WebGLShader | null {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[hdrToneMapper] shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function buildProgram(fragSrc: string): WebGLProgram | null {
    const vert = compileShader(VERT, gl.VERTEX_SHADER);
    const frag = compileShader(fragSrc, gl.FRAGMENT_SHADER);
    if (!vert || !frag) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[hdrToneMapper] program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  _programs.hlg = buildProgram(FRAG_HLG);
  _programs.pq  = buildProgram(FRAG_PQ);

  // Full-screen quad covering [-1,1]² as TRIANGLE_STRIP
  _quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, _quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  _tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, _tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Flip DOM image sources (including VideoFrame) so UV(0,0) = image bottom-left
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  return gl;
}

function getGL(): WebGLRenderingContext | null {
  if (!_gl) _gl = initGL();
  return _gl;
}

// ── Tone-mapping draw ───────────────────────────────────────────────────────

function drawWithToneMapping(sample: VideoSample, ctx: AnyCtx, transfer: 'hlg' | 'pq'): void {
  const gl = getGL();
  const prog = gl ? _programs[transfer] : null;

  if (!gl || !prog || !_canvas || !_quad || !_tex) {
    // WebGL init failed — degrade gracefully (colours may look wrong)
    sample.draw(ctx, 0, 0);
    return;
  }

  const w = sample.displayWidth;
  const h = sample.displayHeight;

  if (!_logged.has(transfer)) {
    _logged.add(transfer);
    console.log(`[hdrToneMapper] ${transfer} tone-mapping active: ${w}×${h}`);
  }

  if (_canvas.width !== w || _canvas.height !== h) {
    _canvas.width  = w;
    _canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  const frame = sample.toVideoFrame();
  try {
    gl.bindTexture(gl.TEXTURE_2D, _tex);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as any);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, _quad);
    const posLoc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();

    const bmp = _canvas.transferToImageBitmap();
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } finally {
    frame.close();
  }
}
