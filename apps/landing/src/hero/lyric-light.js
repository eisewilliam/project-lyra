import { lyricFragments } from './lyrics.js';
import { PHRASE_LENGTH, buildPhrase, envelope, phraseCount, progressOf } from './phrases.js';

// Lyric field revealed by musical light.
//
// Two layers of drifting lyrics live in a texture atlas drawn in the page
// background colour, so they are invisible until light reaches them. A small
// 2D canvas draws the current phrase as light every frame:
//   R  staff and symbol bodies       B  wide glow around them
//   G  moving highlights (drawing tips, glints, note pulses)
// The shader multiplies the lyrics by that light, adds a caustic ripple so the
// light reads as refracted rather than flat, and protects the hero copy.

const MASK_SCALE = 0.5;
const MAX_DPR = 2;

const vertexSource = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uText;
uniform sampler2D uMask;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uLight;
uniform float uTextWidth;
uniform vec2 uPitch;
uniform vec4 uProtect;
uniform vec3 uPointer;
out vec4 outColor;

const vec3 MINT = vec3(0.702, 0.855, 0.820);
const vec3 HIGHLIGHT = vec3(0.91, 1.0, 0.97);
const vec3 GLOW = vec3(0.439, 0.682, 0.663);
const vec3 SEA = vec3(0.165, 0.494, 0.525);
const vec3 TEAL_LIT = vec3(0.24, 0.66, 0.66);

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float lyrics(vec2 p, float pitch, float speed, float seed, float lod, bool near) {
  float row = floor(p.y / pitch);
  float h = hash(row + seed);
  float x = p.x + uTime * speed * (0.6 + 0.9 * h) * uDpr + h * uTextWidth;
  vec4 texel = textureLod(uText, vec2(x / uTextWidth, p.y / uResolution.y), lod);
  return near ? texel.r : texel.g;
}

// Interference of three travelling wave sources, ridged into caustic filigree.
float caustic(vec2 q, float t, vec2 size) {
  vec2 a = vec2(0.22, 0.35) * size + vec2(sin(t * 0.11), cos(t * 0.13)) * 180.0;
  vec2 b = vec2(0.80, 0.55) * size + vec2(cos(t * 0.09), sin(t * 0.07)) * 220.0;
  vec2 c = vec2(0.50, 1.20) * size + vec2(sin(t * 0.05), cos(t * 0.08)) * 260.0;
  float k = 6.2831853 / 96.0;
  float w = sin(length(q - a) * k - t * 0.9)
          + sin(length(q - b) * k * 1.13 - t * 0.74)
          + sin(length(q - c) * k * 0.87 + t * 0.61);
  return pow(1.0 - abs(w / 3.0), 5.0);
}

float protect(vec2 p) {
  vec2 center = (uProtect.xy + uProtect.zw) * 0.5;
  vec2 half_size = (uProtect.zw - uProtect.xy) * 0.5;
  vec2 d = abs(p - center) - half_size;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return mix(0.1, 1.0, smoothstep(-12.0 * uDpr, 72.0 * uDpr, dist));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 uv = p / uResolution;
  vec4 core = textureLod(uMask, uv, 0.6);
  vec4 soft = textureLod(uMask, uv, 2.0);
  float ripple = caustic(p / uDpr, uTime, uResolution / uDpr);
  float level = uLight * protect(p);

  float ribbon = smoothstep(0.03, 0.6, core.r);
  float inside = smoothstep(0.14, 0.72, core.r);
  float filament = smoothstep(0.62, 1.0, core.r);
  float torch = 0.0;
  if (uPointer.z > 0.001) {
    float d = length(p - uPointer.xy) / (150.0 * uDpr);
    torch = uPointer.z * exp(-d * d * 2.4);
  }

  float near = lyrics(p, uPitch.x, 15.0, 3.1, 0.0, true);
  float far = lyrics(p, uPitch.y, 7.0, 11.7, 0.8, false);
  float reveal = level * (inside * (0.55 + 0.9 * ripple) + core.g * 1.1 + soft.b * 0.05) + torch * 0.6;

  // Coloured falloff: words at the edge of the light glow teal, words in its
  // core turn pale mint, and caustic peaks approach white.
  vec3 tint = mix(TEAL_LIT, MINT, smoothstep(0.3, 1.1, reveal));
  vec3 color = tint * near * reveal + TEAL_LIT * far * reveal * 0.22;
  color += HIGHLIGHT * near * level * (core.g * 0.6 + filament * ripple * 0.35);
  // The light itself, visible as it forms the staff and symbol.
  color += level * (SEA * ribbon * (0.2 + 0.16 * ripple) + MINT * filament * (0.05 + 0.2 * ripple) + MINT * core.g * 0.14);
  color += level * (SEA * soft.b * 0.12 + HIGHLIGHT * soft.g * 0.14) + SEA * torch * 0.035;
  color = 1.0 - exp(-color * 1.2);
  color *= smoothstep(0.0, 110.0 * uDpr, uResolution.y - p.y);
  float lit = step(0.003, max(color.r, max(color.g, color.b)));
  color += (hash2(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0) * lit;
  outColor = vec4(max(color, 0.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Lyric light shader failed: ' + log);
  }
  return shader;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rows tile seamlessly: leftover space is shared between the gaps so each row
// is exactly one atlas width long.
function drawLyricRows(ctx, { pitch, size, weight, color, seed }, width, height) {
  ctx.font = `italic ${weight} ${size}px "Geist Variable", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const random = seeded(seed);
  const gap = size * 2.6;
  const rows = Math.ceil(height / pitch);
  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) * pitch;
    const items = [];
    let used = 0;
    let index = Math.floor(random() * lyricFragments.length);
    for (;;) {
      const text = lyricFragments[index % lyricFragments.length];
      const textWidth = ctx.measureText(text).width;
      if (used + textWidth + gap > width) break;
      items.push([text, textWidth]);
      used += textWidth + gap;
      index += 1 + Math.floor(random() * 7);
    }
    if (!items.length) continue;
    const extra = (width - used) / items.length;
    let x = 0;
    for (const [text, textWidth] of items) {
      ctx.fillText(text, x, y);
      x += textWidth + gap + extra;
    }
  }
}

const rgb = (r, g, b) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

// Light profile, outermost first. R is the light body (centre-weighted so the
// shader can find a filament), B the wide glow, G marks symbols inside the body.
const PASSES = [
  { stroke: 6, blob: 2.1, r: 0, b: 0.08 },
  { stroke: 3.2, blob: 1.5, r: 0, b: 0.2 },
  { stroke: 1.5, blob: 1.12, r: 0.2, b: 0.2 },
  { stroke: 1, blob: 1, r: 0.6, b: 0.2, inner: true },
  { stroke: 0.38, blob: 0.72, r: 1, b: 0.2, inner: true },
];

export class LyricLight {
  static create(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    try {
      return new LyricLight(canvas, gl);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.mask = document.createElement('canvas');
    this.maskContext = this.mask.getContext('2d');
    this.atlas = document.createElement('canvas');
    // Start just before the first light so the hero ignites almost at once.
    this.time = 0.75;
    this.playing = false;
    this.frame = 0;
    this.last = 0;
    this.visible = true;
    this.size = { width: 0, height: 0, dpr: 1 };
    this.layout = null;
    this.phrases = new Map();
    this.protectRect = [0, 0, 0, 0];
    this.pointer = { x: 0, y: 0, goalX: 0, goalY: 0, target: 0, strength: 0 };
    this.quality = 1;
    this.slowFrames = 0;
    this.fontsReady = false;
    this.atlasKey = '';
    this.initGL();
    this.onLost = event => { event.preventDefault(); cancelAnimationFrame(this.frame); this.lost = true; };
    this.onRestored = () => { this.lost = false; this.initGL(); this.atlasKey = ''; this.refresh(); };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    const font = `italic 380 16px "Geist Variable"`;
    (document.fonts ? document.fonts.load(font) : Promise.resolve())
      .catch(() => {})
      .then(() => { this.fontsReady = true; this.refresh(); });
  }

  initGL() {
    const { gl } = this;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.uniforms = Object.fromEntries(['uText', 'uMask', 'uResolution', 'uDpr', 'uTime', 'uLight', 'uTextWidth', 'uPitch', 'uProtect', 'uPointer']
      .map(name => [name, gl.getUniformLocation(program, name)]));
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.textTexture = this.createTexture(gl.REPEAT);
    this.maskTexture = this.createTexture(gl.CLAMP_TO_EDGE);
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }

  createTexture(wrapS) {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  // Layout comes from the DOM: the hero size and the copy block the light avoids.
  resize(width, height, copyRect) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.quality;
    const compact = width < 700;
    const stageTop = copyRect.bottom + (compact ? 28 : 40);
    const stageBottom = height - (compact ? 40 : 56);
    const stageHeight = Math.max(160, stageBottom - stageTop);
    const unit = compact ? Math.min(32, Math.max(28, stageHeight / 8.2)) : Math.max(26, Math.min(46, width * 0.024 + 10, stageHeight / 8.2));
    const pitch = unit / 2;
    let cy = stageTop + stageHeight * (compact ? 0.52 : 0.5);
    cy = (Math.round(cy / pitch - 0.5) + 0.5) * pitch;
    this.size = { width, height, dpr };
    this.layout = { width, height, unit, pitch, cy, compact };
    this.protectRect = [copyRect.left, copyRect.top, copyRect.right, copyRect.bottom];
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.mask.width = Math.ceil(width * MASK_SCALE);
    this.mask.height = Math.ceil(height * MASK_SCALE);
    this.phrases.clear();
    this.refresh();
  }

  buildAtlas() {
    const { gl, canvas, layout } = this;
    const key = [canvas.height, layout.pitch, this.size.dpr].join(':');
    if (key === this.atlasKey) return;
    this.atlasKey = key;
    const dpr = this.size.dpr;
    const width = Math.min(this.maxTexture, Math.round(2048 * dpr));
    const height = canvas.height;
    this.atlas.width = width;
    this.atlas.height = height;
    const ctx = this.atlas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const nearPitch = layout.pitch * dpr;
    const farPitch = nearPitch * 0.66;
    drawLyricRows(ctx, { pitch: nearPitch, size: nearPitch * 0.62, weight: 380, color: '#f00', seed: 7 }, width, height);
    ctx.globalCompositeOperation = 'lighter';
    drawLyricRows(ctx, { pitch: farPitch, size: farPitch * 0.6, weight: 360, color: '#0f0', seed: 19 }, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, this.atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.textWidth = width;
    this.pitch = [nearPitch, farPitch];
  }

  phrase(index) {
    if (!this.phrases.has(index)) this.phrases.set(index, buildPhrase(index, this.layout));
    return this.phrases.get(index);
  }

  // Passes run outermost first across every element, so with plain source-over
  // each pass only ever raises the light: crossings stay bright, never seamed,
  // and every draw uses hardware blending.
  drawMask(elements, tau) {
    const ctx = this.maskContext;
    const { unit } = this.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.mask.width, this.mask.height);
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const visible = [];
    for (const element of elements) {
      const progress = progressOf(element, tau);
      if (progress > 0) visible.push({ element, progress, end: element.kind === 'stroke' ? this.pointAt(element, progress) : null });
    }
    for (const pass of PASSES) {
      for (const { element, progress, end } of visible) {
        const symbol = element.staff === undefined ? (element.solid ? 0.42 : 0.24) : 0;
        const fade = element.kind === 'blob' ? progress : 1;
        const color = rgb(pass.r * fade, pass.inner ? symbol * fade : 0, pass.b * fade);
        if (element.kind === 'blob') this.ellipse(element, (0.55 + 0.45 * progress) * pass.blob, color);
        else if (element.widthAt) this.outline(element, progress, end, pass.stroke, color);
        else this.line(element, progress, end, pass.stroke, color);
      }
    }

    // Moving highlights are additive: drawing tips, glints on the staff, note pulses.
    ctx.globalCompositeOperation = 'lighter';
    const sustain = Math.min(1, Math.max(0, (tau - 4.6) / 1.2));
    for (const { element, progress, end } of visible) {
      if (element.kind === 'blob') {
        const pulse = element.pulse ? element.pulse(tau) : 0;
        if (pulse > 0.01) this.ellipse(element, 1.2, `rgba(0,255,0,${0.75 * pulse})`);
        continue;
      }
      if (element.head !== false && progress < 1) this.spark(end[0], end[1], unit * 1.15, Math.sin(Math.PI * progress) ** 0.5 * 0.9);
      if (element.staff !== undefined && sustain > 0) {
        const along = (tau * 0.055 * (1 + 0.27 * element.staff) + element.staff * 0.37) % 1;
        const point = this.pointAt(element, along);
        this.spark(point[0], point[1], unit * 0.75, 0.7 * sustain);
      }
    }
  }

  ellipse(element, scale, color) {
    const ctx = this.maskContext;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(element.x, element.y, element.rx * scale, element.ry * scale, element.rotation, 0, Math.PI * 2);
    ctx.fill();
  }

  spark(x, y, radius, alpha) {
    if (alpha <= 0.01) return;
    const ctx = this.maskContext;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(0,255,0,${alpha})`);
    gradient.addColorStop(1, 'rgba(0,255,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  pointAt(element, fraction) {
    const target = fraction * element.total;
    const { cum, points } = element;
    let low = 0;
    let high = cum.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cum[mid] < target) low = mid + 1; else high = mid;
    }
    if (low === 0) return points[0];
    const span = cum[low] - cum[low - 1] || 1;
    const t = (target - cum[low - 1]) / span;
    const [x0, y0] = points[low - 1];
    const [x1, y1] = points[low];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  }

  // Visible part of a constant-width stroke as one path.
  line(element, progress, end, scale, color) {
    const ctx = this.maskContext;
    const limit = progress * element.total;
    const { points, cum } = element;
    ctx.strokeStyle = color;
    ctx.lineWidth = element.width * scale;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length && cum[i] < limit; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  }

  // Visible part of a swelling stroke as one filled outline with round ends.
  outline(element, progress, end, scale, color) {
    const ctx = this.maskContext;
    const limit = progress * element.total;
    const { points, cum } = element;
    const path = [];
    for (let i = 0; i < points.length && cum[i] < limit; i += 1) path.push([points[i], cum[i]]);
    path.push([end, limit]);
    if (path.length < 2) return;
    const left = [];
    const right = [];
    for (let i = 0; i < path.length; i += 1) {
      const [[x, y], distance] = path[i];
      const [px, py] = path[Math.max(0, i - 1)][0];
      const [nx, ny] = path[Math.min(path.length - 1, i + 1)][0];
      const length = Math.hypot(nx - px, ny - py) || 1;
      const half = (element.widthAt(distance / element.total) * scale) / 2;
      const ox = (-(ny - py) / length) * half;
      const oy = ((nx - px) / length) * half;
      left.push([x + ox, y + oy]);
      right.push([x - ox, y - oy]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i += 1) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i -= 1) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    for (const index of [0, path.length - 1]) {
      const [[x, y], distance] = path[index];
      ctx.moveTo(x, y);
      ctx.arc(x, y, (element.widthAt(distance / element.total) * scale) / 2, 0, Math.PI * 2);
    }
    ctx.fill('nonzero');
  }

  render() {
    if (this.destroyed || this.lost || !this.layout || !this.fontsReady || !this.canvas.width) return;
    this.buildAtlas();
    const { gl, uniforms: u } = this;
    const index = Math.floor(this.time / PHRASE_LENGTH) % phraseCount;
    const tau = this.time % PHRASE_LENGTH;
    this.drawMask(this.phrase(index), tau);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.mask);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);

    const { dpr } = this.size;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform1i(u.uText, 0);
    gl.uniform1i(u.uMask, 1);
    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uLight, envelope(tau));
    gl.uniform1f(u.uTextWidth, this.textWidth);
    gl.uniform2f(u.uPitch, this.pitch[0], this.pitch[1]);
    const [left, top, right, bottom] = this.protectRect;
    gl.uniform4f(u.uProtect, left * dpr, top * dpr, right * dpr, bottom * dpr);
    gl.uniform3f(u.uPointer, this.pointer.x * dpr, this.pointer.y * dpr, this.pointer.strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  tick = now => {
    this.frame = 0;
    if (!this.playing || !this.visible) return;
    const delta = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    this.time += Math.min(delta, 0.05);
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 6);
    this.pointer.strength += (this.pointer.target - this.pointer.strength) * ease;
    this.pointer.x += (this.pointer.goalX - this.pointer.x) * ease * 1.4;
    this.pointer.y += (this.pointer.goalY - this.pointer.y) * ease * 1.4;
    this.render();
    this.adapt(delta);
    this.frame = requestAnimationFrame(this.tick);
  };

  // Drop resolution on hardware that cannot hold a smooth frame rate.
  adapt(delta) {
    if (!delta) return;
    this.slowFrames = delta > 0.028 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.quality > 0.6) {
      this.slowFrames = 0;
      this.quality -= 0.2;
      this.onQualityChange?.();
    }
  }

  schedule() {
    if (this.playing && this.visible && !this.frame) {
      this.last = 0;
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  refresh() {
    if (this.playing && this.visible) this.schedule();
    else this.render();
  }

  setPlaying(playing) {
    this.playing = playing;
    if (!playing) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pointer.strength = 0;
      this.pointer.target = 0;
    }
    this.refresh();
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.schedule();
  }

  setTime(time) {
    this.time = time;
    this.refresh();
  }

  setPointer(x, y, active) {
    if (active && this.pointer.target === 0) {
      this.pointer.x = x;
      this.pointer.y = y;
    }
    this.pointer.goalX = x;
    this.pointer.goalY = y;
    this.pointer.target = active ? 0.55 : 0;
  }

  // Release GPU resources but keep the context: React may remount on the same canvas.
  destroy() {
    cancelAnimationFrame(this.frame);
    this.destroyed = true;
    this.playing = false;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const { gl } = this;
    gl.deleteTexture(this.textTexture);
    gl.deleteTexture(this.maskTexture);
    gl.deleteProgram(this.program);
  }
}
