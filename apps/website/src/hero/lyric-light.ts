import { lyricFragments } from './lyrics.ts';
import {
  FORM, GROW, PHRASE_LENGTH, POUR_END, POUR_START, STEM_DELAY, clamp01, clefShape, easeInOut, easeOut, figures, melt,
  phraseCount, settledAt, smooth, sweep,
  type Figure, type NoteSpec, type Point,
} from './phrases.ts';

// Glass score.
//
// Lines from public-domain songs drift in the dark behind the hero, invisible
// on their own. A staff of five glass rods runs the width of the screen on a
// slow travelling wave, and each phrase a musical figure is set on the staff
// in glass: a clef pours along its own stroke, notes land as drops and grow
// their stems, beams and marks pour across. The glass works as a lens: the
// words show through it, gently magnified, and it gives off a little light of
// its own. The moving glimmer briefly splits the light at each glass edge, red
// bending least and blue most. Rods ring when a note lands and when the cursor
// plucks them, and the figure melts back into the staff before the next phrase.
//
// Everything is drawn in one fragment shader from distances: exact shapes for
// rods, notes and marks, and a distance field built once per layout for each
// clef, so edges stay crisp at any size. The CPU times the score, simulates the
// rods as strings and places the shapes.

// Keep the decorative field below full Retina resolution; the page's text
// remains native-resolution, and the distance fields keep glass edges sharp.
const MAX_DPR = 1.5;
const STRINGS = 5;
const NODES = 64;
const MAX_PRIMS = 16;
const MAX_FLASHES = 8;
// On the first visit the staff is strung: the rods draw in from the left one
// after another, loose and rippling like ribbons, then pull taut into the
// staff. Seconds each rod takes to draw in, between one rod and the next, and
// how long the field takes to fade up.
const INTRO = 1.9;
const INTRO_STAGGER = 0.1;
const FADE_IN = 1.0;
// A rod starts to pull taut this long before it has drawn in, and its ripple
// eases away over about this long.
const TAUT_EARLY = 0.35;
const TAUT = 0.6;
// The score holds on the empty staff while it is strung, then starts this long
// before the first figure, so the first clef pours as the rods settle.
const INTRO_HOLD = 1.9;
const LEAD = 0.4;
// The figures are set this much larger than the staff the lyrics are sized
// to, so the glass reads as an object rather than a line of type.
const SHAPE_SCALE = 1.18;
// The widest figure spans about this many staff spaces, the tallest about this many.
const FIGURE_WIDTH = 14.5;
const FIGURE_HEIGHT = 10;
// Clef distance fields are built at this many texels per CSS pixel.
const CLEF_SCALE = 2;

const vertexSource = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform highp sampler2D uStrings;
uniform sampler2D uClef;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uFieldWidth;
uniform vec2 uFieldPitch;
uniform vec4 uProtect;
uniform vec4 uStaff;
uniform vec3 uRod;
uniform float uTips[${STRINGS}];
uniform vec3 uWave;
uniform vec3 uSwell;
uniform vec2 uBand;
uniform vec4 uFigureBox;
uniform float uFade;
uniform vec4 uStage;
uniform vec4 uPrimA[${MAX_PRIMS}];
uniform vec4 uPrimB[${MAX_PRIMS}];
uniform int uPrimCount;
uniform vec4 uFlashes[${MAX_FLASHES}];
uniform vec4 uClefRect;
uniform vec4 uClefState;
uniform float uClefScale;
uniform vec4 uLight;
uniform vec3 uPointer;
uniform float uAberration;
out vec4 outColor;

const int STRINGS = ${STRINGS};
const int NODES = ${NODES};
const int MAX_PRIMS = ${MAX_PRIMS};
const int MAX_FLASHES = ${MAX_FLASHES};

const vec3 SEA = vec3(0.165, 0.494, 0.525);
const vec3 TEAL_LIT = vec3(0.24, 0.66, 0.66);
const vec3 MINT = vec3(0.702, 0.855, 0.820);
const vec3 PAPER = vec3(0.933, 0.961, 0.953);
// How bright the light is overall. The colour split keeps its own strength.
const float LIFT = 1.25;

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float dot2(vec2 v) { return dot(v, v); }

// 0 behind the hero copy, rising to 1 clear of it.
float clearance(vec2 p) {
  vec2 center = (uProtect.xy + uProtect.zw) * 0.5;
  vec2 half_size = (uProtect.zw - uProtect.xy) * 0.5;
  vec2 d = abs(p - center) - half_size;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return smoothstep(8.0 * uDpr, 120.0 * uDpr, dist);
}

// Two layers of lyrics drifting in the dark: near words and fainter far ones.
float layer(vec2 p, float pitch, float speed, float seed, float lod, bool near) {
  float row = floor(p.y / pitch);
  float h = hash(row + seed);
  float x = p.x + uTime * speed * (0.6 + 0.9 * h) * uDpr + h * uFieldWidth;
  vec4 texel = textureLod(uField, vec2(x / uFieldWidth, p.y / uResolution.y), lod);
  return near ? texel.r : texel.g;
}

// The lyrics at p, lit by this much light: teal at the edge of the light,
// pale mint in its core.
vec3 lyrics(vec2 p, float light) {
  // Light falls away quickly, so words glow near the glass and fade into the dark.
  light = pow(max(light, 0.0), 1.4) * 1.35 * LIFT;
  if (light < 0.004) return vec3(0.0);
  float near = layer(p, uFieldPitch.x, 15.0, 3.1, 0.0, true);
  float far = layer(p, uFieldPitch.y, 7.0, 11.7, 0.8, false);
  vec3 tint = mix(TEAL_LIT, MINT, smoothstep(0.3, 1.1, light));
  return tint * near * light + TEAL_LIT * far * light * 0.22;
}

// A low light behind the staff, so the glass has something to bend.
vec3 stage(vec2 p) {
  vec2 q = (p - uStage.xy) / uStage.zw;
  return SEA * 0.08 * LIFT * exp(-dot(q, q));
}

// One rod's vibration at x, from a Catmull-Rom curve through the string's nodes.
float node(int k, int j) { return texelFetch(uStrings, ivec2(clamp(j, 0, NODES - 1), k), 0).r; }
float vibration(int k, float x, out float slope) {
  float span = uStaff.y - uStaff.x;
  float u = clamp((x - uStaff.x) / span, 0.0, 1.0) * float(NODES - 1);
  int j = min(int(u), NODES - 2);
  float t = u - float(j);
  float p0 = node(k, j - 1), p1 = node(k, j), p2 = node(k, j + 1), p3 = node(k, j + 2);
  float a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  float b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
  float c = -0.5 * p0 + 0.5 * p2;
  slope = ((3.0 * a * t + 2.0 * b) * t + c) * float(NODES - 1) / span;
  return ((a * t + b) * t + c) * t + p1;
}

// Distance to one shape, with its outward normal. Shapes are capsules (a
// circle when both ends meet), rings, and arcs over the top.
float primitive(int i, vec2 p, out vec2 normal) {
  vec4 a = uPrimA[i];
  vec4 b = uPrimB[i];
  int kind = int(b.y + 0.5);
  if (kind == 1) {
    vec2 q = p - a.xy;
    float len = max(length(q), 1e-4);
    float s = len - a.z;
    normal = q / len * (s < 0.0 ? -1.0 : 1.0);
    return abs(s) - b.x;
  }
  if (kind == 2) {
    // Thickest at the crown, tapering towards both ends like an engraved fermata.
    vec2 q = p - a.xy;
    float angle = atan(q.x, -q.y);
    float span = max(a.w, 1e-3);
    if (abs(angle) <= span) {
      float len = max(length(q), 1e-4);
      float s = len - a.z;
      normal = q / len * (s < 0.0 ? -1.0 : 1.0);
      return abs(s) - b.x * (0.35 + 0.65 * cos(angle / span * 1.5708));
    }
    vec2 end = a.xy + a.z * vec2(sin(span) * sign(angle), -cos(span));
    vec2 r = p - end;
    float len = max(length(r), 1e-4);
    normal = r / len;
    return len - b.x * 0.35;
  }
  vec2 pa = p - a.xy;
  vec2 ba = a.zw - a.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  vec2 v = pa - ba * h;
  float len = max(length(v), 1e-4);
  normal = v / len;
  return len - b.x;
}

// Signed distance to the clef as far as it has poured, in canvas pixels, with
// its outward normal and the stroke's half width there.
float clef(vec2 p, out vec2 normal, out float half_width) {
  normal = vec2(0.0, 1.0);
  half_width = 0.0;
  if (uClefScale <= 0.0) return 1e6;
  vec2 size = vec2(textureSize(uClef, 0));
  vec2 uv = (p - uClefRect.xy) / uClefRect.zw;
  vec2 inside = clamp(uv, 0.5 / size, 1.0 - 0.5 / size);
  float beyond = length((uv - inside) * uClefRect.zw);
  vec3 field = texture(uClef, inside).rgb;
  half_width = field.b * uClefScale;
  float body = field.r * uClefScale + beyond;
  // Cut the stroke at the pour front, measured along the stroke.
  float front = (field.g - uClefState.x) * uClefState.w;
  float k = 0.25 * uStaff.w;
  float h = clamp(0.5 - 0.5 * (front - body) / k, 0.0, 1.0);
  float d = mix(front, body, h) + k * h * (1.0 - h);
  if (beyond == 0.0 && d < uRod.y + 4.0 * uDpr) {
    // A wider sample smooths the reflected rim without softening the outline.
    vec2 e = 1.5 / size;
    vec2 dx = texture(uClef, inside + vec2(e.x, 0.0)).rg - texture(uClef, inside - vec2(e.x, 0.0)).rg;
    vec2 dy = texture(uClef, inside + vec2(0.0, e.y)).rg - texture(uClef, inside - vec2(0.0, e.y)).rg;
    vec2 grad = vec2(dx.r, dy.r) * uClefScale;
    vec2 along = vec2(dx.g, dy.g) * uClefState.w;
    normal = normalize(mix(along + 1e-6, grad + 1e-6, h));
  } else if (beyond > 0.0) {
    normal = normalize(uv - inside);
  }
  // Melting thins the whole stroke away.
  half_width = max(half_width - uClefState.y, 0.5);
  return d + uClefState.y;
}

// The staff's travelling wave at x: a long swell moving left to right with a
// shorter one over it. Returns the offset and its slope.
float staffWave(float x, out float slope) {
  float a = uWave.y * x - uWave.z;
  float b = uSwell.y * x - uSwell.z;
  slope = uWave.x * uWave.y * cos(a) + uSwell.x * uSwell.y * cos(b);
  return uWave.x * sin(a) + uSwell.x * sin(b);
}

struct Glass {
  float d;        // signed distance, negative inside
  vec2 normal;    // outward direction of the surface
  float symbol;   // how much of the glass here is a figure rather than a rod
  vec2 center;    // the nearest note head's centre, for its lens
  float lens;     // how much of the glass here is a note head
  float light;    // faint spill from the glass, reaching this point
  float half_width; // half the thickness of the glass here, for its bevel
  float tip;      // where the nearest rod ends while the staff is drawing in
};

Glass glass(vec2 p) {
  float waveSlope;
  float wave = staffWave(p.x, waveSlope);
  Glass g = Glass(1e6, vec2(0.0, 1.0), 0.0, p, 0.0, 0.0, uRod.x, 1e7);
  for (int k = 0; k < STRINGS; k++) {
    float slope;
    float y = uStaff.z + float(k - 2) * uStaff.w + wave + vibration(k, p.x, slope);
    slope += waveSlope;
    float dy = p.y - y;
    // On the first visit each rod draws in from the left, with a rounded tip.
    float tip = uTips[k];
    float d;
    vec2 normal;
    if (p.x > tip) {
      vec2 q = vec2(p.x - tip, dy);
      d = length(q) - uRod.x;
      normal = normalize(q);
    } else {
      d = abs(dy) * inversesqrt(1.0 + slope * slope) - uRod.x;
      normal = normalize(vec2(-slope, 1.0)) * (dy < 0.0 ? -1.0 : 1.0);
    }
    if (d < g.d) {
      g.d = d;
      g.normal = normal;
      g.tip = tip;
    }
  }
  // The rods give off a little light of their own, more where the glimmer
  // passes; the words are revealed mainly through the glass itself.
  float glint = exp(-pow((p.x - uLight.z) / (140.0 * uDpr), 2.0));
  g.light = uLight.w * 0.6 * (1.0 + 2.5 * glint) * exp(-max(g.d, 0.0) / (0.4 * uStaff.w));

  // Figures flow into the staff through a smooth minimum, like liquid glass.
  // Most of the staff is nowhere near the figure, so skip it there.
  if (p.x < uFigureBox.x || p.y < uFigureBox.y || p.x > uFigureBox.z || p.y > uFigureBox.w) return g;
  float reach = 0.8 * uStaff.w;
  for (int i = 0; i < MAX_PRIMS; i++) {
    if (i >= uPrimCount) break;
    vec2 n;
    float d = primitive(i, p, n);
    vec4 a = uPrimA[i];
    vec4 b = uPrimB[i];
    float h = clamp(0.5 + 0.5 * (g.d - d) / b.w, 0.0, 1.0);
    // Most pixels receive light without touching this piece of glass. Only
    // blend surface normals and lens properties where the shapes meet.
    if (h > 0.0) {
      g.d = mix(g.d, d, h) - b.w * h * (1.0 - h);
      g.normal = normalize(mix(g.normal, n, h) + 1e-6);
      g.symbol = mix(g.symbol, 1.0, h);
      g.half_width = mix(g.half_width, b.x, h);
      bool bead = int(b.y + 0.5) == 0 && a.xy == a.zw;
      g.center = mix(g.center, bead ? a.xy : p, h);
      g.lens = mix(g.lens, bead ? 1.0 : 0.0, h);
    }
    g.light = max(g.light, b.z * 0.26 * exp(-max(d, 0.0) / reach));
  }
  vec2 n;
  float half_width;
  float d = clef(p, n, half_width);
  if (d < 1e5) {
    float k = 0.16 * uStaff.w;
    float h = clamp(0.5 + 0.5 * (g.d - d) / k, 0.0, 1.0);
    g.d = mix(g.d, d, h) - k * h * (1.0 - h);
    g.normal = normalize(mix(g.normal, n, h) + 1e-6);
    g.symbol = mix(g.symbol, 1.0, h);
    g.half_width = mix(g.half_width, half_width, h);
    g.lens = mix(g.lens, 0.0, h);
    g.light = max(g.light, uClefState.z * 0.26 * exp(-max(d, 0.0) / reach));
  }
  return g;
}

// The figure alone, for its caustic: distance and the light it carries.
float figure(vec2 p, out float light) {
  float d = 1e6;
  light = 0.0;
  if (p.x < uFigureBox.x || p.y < uFigureBox.y || p.x > uFigureBox.z || p.y > uFigureBox.w) return d;
  for (int i = 0; i < MAX_PRIMS; i++) {
    if (i >= uPrimCount) break;
    vec2 n;
    float di = primitive(i, p, n);
    if (di < d) { d = di; light = uPrimB[i].z; }
  }
  vec2 n;
  float half_width;
  float dc = clef(p, n, half_width);
  if (dc < d) { d = dc; light = uClefState.z; }
  return d;
}

// Where glass is forming, it catches the light for a moment, like the glimmer.
float flashes(vec2 p) {
  float light = 0.0;
  for (int i = 0; i < MAX_FLASHES; i++) {
    vec4 flash = uFlashes[i];
    if (flash.w <= 0.001) continue;
    light = max(light, flash.w * exp(-dot2(p - flash.xy) / (flash.z * flash.z)));
  }
  return light;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  float clear = clearance(p);
  // Lyrics and light stay almost hidden behind the copy; the glass itself
  // runs behind it more softly, so the staff reads as one line across the hero.
  float guard = mix(0.06, 1.0, clear);
  float glassGuard = mix(0.32, 1.0, clear);
  float space = uStaff.w;

  // The cursor carries a small light of its own.
  float torch = 0.0;
  if (uPointer.z > 0.001) {
    float d = length(p - uPointer.xy) / (130.0 * uDpr);
    torch = uPointer.z * exp(-d * d * 2.4);
  }

  vec3 low = stage(p);
  vec3 color = low;
  vec3 sheen = vec3(0.0);
  float cover = 0.0;
  float light = torch * 0.6;
  if (p.y > uBand.x && p.y < uBand.y) {
    Glass g = glass(p);
    light += g.light;
    // Keep the usual color split quiet. Only the moving glimmer, and the tips
    // of the rods as they first draw in, bring it back to full strength,
    // locally, as they cross the glass.
    float glimmer = exp(-pow((p.x - uLight.z) / (80.0 * uDpr), 2.0));
    glimmer = max(glimmer, (1.0 - uRod.z) * exp(-pow((p.x - g.tip) / (70.0 * uDpr), 2.0)));
    glimmer = max(glimmer, flashes(p));
    float dispersion = mix(0.06, 1.0, glimmer);

    // Light through the figure lands down and away from the key light as a
    // soft copy of it: thicker glass focuses more, and its edge splits into colour.
    float carried;
    float c = figure(p + uLight.xy * 1.15 * space, carried);
    vec3 caustic = carried * vec3(
      smoothstep(0.55 * space, -0.15 * space, c),
      smoothstep(0.4 * space, -0.25 * space, c),
      smoothstep(0.25 * space, -0.35 * space, c));
    caustic *= 0.45 + 0.55 * smoothstep(0.0, -0.5 * space, c);
    float rays = dot(caustic, vec3(1.0 / 3.0));
    caustic = mix(vec3(rays), caustic, dispersion);
    // Reflections remain subtle; the caustic doesn't flood the lyric field.
    light += rays * 0.05;
    // The glass sits just above the lyrics: words dim a little where they
    // pass under its edge, which lifts it off the page.
    vec3 words = lyrics(p, light) * (1.0 - 0.45 * exp(-max(g.d, 0.0) / (3.0 * uDpr)));
    // Words in the caustic's coloured edge take its colour, and the glass's
    // own light shows as a faint glow around it.
    color += words + words.g * (caustic - rays) * 0.08 + (MINT * rays * 0.008 + MINT * g.light * 0.07) * LIFT;

    cover = smoothstep(0.75 * uDpr, -0.75 * uDpr, g.d);
    if (cover > 0.0) {
      // Liquid glass is a slab: a flat face and a rounded rim, the rim never
      // wider than the glass is thick. Everything optical happens in the rim.
      float rim = max(min(uRod.y, g.half_width), 0.75 * uDpr);
      // 1 at the very edge, 0 where the flat face begins.
      float edge = 1.0 - clamp(-g.d / rim, 0.0, 1.0);
      // The face is flat and the rim curves away steeply at the very edge.
      vec3 n = normalize(vec3(g.normal * edge * edge * (1.4 + 2.2 * edge), 1.0));

      // Lensing: the rim bends the view inwards, drawing what lies just past
      // the edge into it; the face shows the background as it is, a touch
      // magnified under a note head. Each channel bends differently, so the
      // rim splits into colour when the glimmer passes.
      vec2 bend = -g.normal * rim * 0.8 * pow(edge, 1.6) + (g.center - p) * 0.06 * g.lens;
      // Glass thinner than a line of text only shows slivers of words, so it
      // lets through little except where the glimmer passes; note heads and
      // the thick of a clef are the real lenses.
      float wide = smoothstep(0.12 * space, 0.5 * space, g.half_width);
      float seenLight = mix(0.16 + 0.2 * glimmer, mix(0.3, 0.95, wide), g.symbol) + torch * 0.4;
      float a = uAberration * dispersion;
      vec3 seen = low + vec3(
        lyrics(p + bend * (1.0 - a), seenLight).r,
        lyrics(p + bend, seenLight).g,
        lyrics(p + bend * (1.0 + a), seenLight).b);
      // The material lifts what is behind it a little and adds a faint
      // milkiness, lighter towards the key light, so the glass reads as a
      // pane lighter than the dark around it.
      float toward = 0.5 + 0.5 * dot(normalize(p - g.center + 1e-4), -uLight.xy) * g.lens;
      vec3 body = seen * 1.08 + (PAPER * 0.03 + MINT * 0.012) * mix(1.0, 0.6 + 0.8 * toward, g.lens);

      // Specular: a crisp line right on the edge, brightest where the edge
      // faces the light, still bright on the opposite side, dim across. As
      // the glimmer passes it splits by wavelength, red just outside blue.
      float facing = dot(g.normal, uLight.xy);
      float catchLight = 0.22 + 0.78 * pow(abs(facing), 1.5) * (facing > 0.0 ? 1.0 : 0.6);
      float shift = 0.7 * uDpr * dispersion * (1.0 + 2.0 * uAberration);
      vec3 line = (-g.d - 0.6 * uDpr + vec3(-shift, 0.0, shift)) / (0.7 * uDpr);
      line = exp(-line * line);
      // Inside the rim a soft light runs all the way round, giving the glass
      // its thickness; the glimmer sweeps a broad sheen across the face.
      float inner = pow(edge, 2.5);
      color = mix(color, body, cover);
      sheen = PAPER * (line * catchLight * (0.85 + 0.9 * glimmer) + (inner * (0.08 + 0.1 * max(facing, 0.0)) + 0.07 * glimmer) * LIFT);
      // The symbols lead: the staff is quieter, and quieter still away from
      // the figure, so the eye goes to the glass that is changing.
      float focus = exp(-pow((p.x - uStage.x) / (uStage.z * 1.15), 2.0));
      float staffLevel = mix(0.22, 0.4, focus) * LIFT + 0.45 * glimmer;
      sheen *= cover * mix(staffLevel, 1.3, g.symbol);
      color = mix(low + (color - low) * mix(staffLevel, 1.0, g.symbol), color, 1.0 - cover);
    }
  } else {
    color += lyrics(p, light);
  }

  // The copy is protected from everything but the low stage light, which
  // would otherwise show the edge of the protected area.
  color = low + (color - low) * guard + sheen * glassGuard;
  color *= uFade * smoothstep(0.0, 110.0 * uDpr, uResolution.y - p.y);
  float lit = step(0.003, max(color.r, max(color.g, color.b)));
  color += (hash2(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0) * lit;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Glass score shader could not be created');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Glass score shader failed: ' + log);
  }
  return shader;
}

function seeded(seed: number) {
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
interface LyricRows {
  pitch: number;
  size: number;
  weight: number;
  color: string;
  seed: number;
}

function drawLyricRows(ctx: CanvasRenderingContext2D, { pitch, size, weight, color, seed }: LyricRows, width: number, height: number) {
  ctx.font = `italic ${weight} ${size}px "Geist Variable", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const random = seeded(seed);
  const gap = size * 2.6;
  const rows = Math.ceil(height / pitch);
  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) * pitch;
    const items: [text: string, width: number][] = [];
    let used = 0;
    let index = Math.floor(random() * lyricFragments.length);
    for (;;) {
      const text = lyricFragments[index % lyricFragments.length] ?? '';
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

// One-dimensional squared distance transform (Felzenszwalb and Huttenlocher),
// also reporting which site each cell is nearest to.
const FAR = 1e20;
function transform1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let r = v[k]!;
    let s = ((f[q]! + q * q) - (f[r]! + r * r)) / (2 * q - 2 * r);
    while (s <= z[k]!) {
      k -= 1;
      r = v[k]!;
      s = ((f[q]! + q * q) - (f[r]! + r * r)) / (2 * q - 2 * r);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1]! < q) k += 1;
    const r = v[k]!;
    d[q] = (q - r) * (q - r) + f[r]!;
    arg[q] = r;
  }
}

// Squared distance from every cell to the nearest site, and that site's index.
function transform2d(sites: Uint8Array, width: number, height: number) {
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const arg = new Int32Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const columnDistance = new Float64Array(width * height);
  const columnRow = new Int32Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = sites[y * width + x] ? 0 : FAR;
    transform1d(f, height, d, arg, v, z);
    for (let y = 0; y < height; y += 1) {
      columnDistance[y * width + x] = d[y]!;
      columnRow[y * width + x] = arg[y]!;
    }
  }
  const distance = new Float64Array(width * height);
  const nearest = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = columnDistance[y * width + x]!;
    transform1d(f, width, d, arg, v, z);
    for (let x = 0; x < width; x += 1) {
      const column = arg[x]!;
      distance[y * width + x] = d[x]!;
      nearest[y * width + x] = columnRow[y * width + column]! * width + column;
    }
  }
  return { distance, nearest };
}

// A clef's distance field: signed distance to the stroke in texels (R), how
// far along the stroke the nearest part of it is from 0 to 1 (G), and the
// stroke's half width there in texels (B).
interface ClefField {
  kind: 'treble' | 'bass';
  width: number;
  height: number;
  data: Float32Array;
  // Texture box relative to the clef's origin on the middle line, in CSS pixels.
  rect: [x: number, y: number, width: number, height: number];
  // Stroke length, in CSS pixels.
  length: number;
  // The stroke and its width, in CSS pixels from the clef's origin, for the pour tip.
  points: Point[];
  widths: number[];
  cum: number[];
  blobs: { at: Point; radius: number; when: 'start' | 'end' | 'after' }[];
  thickest: number;
}

function buildClef(kind: 'treble' | 'bass', space: number): ClefField {
  const shape = clefShape(kind);
  const points = shape.points.map(([x, y]): Point => [x * space, y * space]);
  const widths = shape.widths.map(width => width * space);
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  }
  const length = cum.at(-1) || 1;
  const pad = space * 1.2;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  points.forEach(([x, y], i) => {
    const half = widths[i]! / 2;
    minX = Math.min(minX, x - half);
    minY = Math.min(minY, y - half);
    maxX = Math.max(maxX, x + half);
    maxY = Math.max(maxY, y + half);
  });
  const rect: ClefField['rect'] = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2];
  const width = Math.ceil(rect[2] * CLEF_SCALE);
  const height = Math.ceil(rect[3] * CLEF_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Glass score needs a 2D canvas');
  ctx.setTransform(CLEF_SCALE, 0, 0, CLEF_SCALE, -rect[0] * CLEF_SCALE, -rect[1] * CLEF_SCALE);
  ctx.fillStyle = '#fff';
  // The swelling stroke as quads between neighbouring points, with round joins.
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i]!;
    ctx.beginPath();
    ctx.arc(x, y, widths[i]! / 2, 0, Math.PI * 2);
    ctx.fill();
    const next = points[i + 1];
    if (!next) continue;
    const dx = next[0] - x;
    const dy = next[1] - y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const a = widths[i]! / 2;
    const b = widths[i + 1]! / 2;
    ctx.beginPath();
    ctx.moveTo(x + nx * a, y + ny * a);
    ctx.lineTo(next[0] + nx * b, next[1] + ny * b);
    ctx.lineTo(next[0] - nx * b, next[1] - ny * b);
    ctx.lineTo(x - nx * a, y - ny * a);
    ctx.fill();
  }
  const alpha = ctx.getImageData(0, 0, width, height).data;
  const inside = new Uint8Array(width * height);
  const outside = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i += 1) {
    const filled = alpha[i * 4 + 3]! >= 128;
    inside[i] = filled ? 1 : 0;
    outside[i] = filled ? 0 : 1;
  }
  const toInside = transform2d(inside, width, height);
  const toOutside = transform2d(outside, width, height);

  // How far along the stroke each filled texel is, and how thick the stroke is
  // there: project onto the nearest segment. Each segment only visits the
  // texels its stroke can reach, which keeps the build off the critical path.
  const along = new Float32Array(width * height);
  const half = new Float32Array(width * height);
  const best = new Float32Array(width * height).fill(Infinity);
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const sx = bx - ax;
    const sy = by - ay;
    const reach = Math.max(widths[i]!, widths[i + 1]!) + 1 / CLEF_SCALE;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - rect[0]) * CLEF_SCALE));
    const x1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + reach - rect[0]) * CLEF_SCALE));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - rect[1]) * CLEF_SCALE));
    const y1 = Math.min(height - 1, Math.ceil((Math.max(ay, by) + reach - rect[1]) * CLEF_SCALE));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const index = y * width + x;
        if (!inside[index]) continue;
        const px = (x + 0.5) / CLEF_SCALE + rect[0];
        const py = (y + 0.5) / CLEF_SCALE + rect[1];
        const t = clamp01(((px - ax) * sx + (py - ay) * sy) / (sx * sx + sy * sy || 1));
        const dx = px - ax - sx * t;
        const dy = py - ay - sy * t;
        // Prefer the segment whose stroke is widest here, so crossings belong to the thicker pass.
        const distance = (dx * dx + dy * dy) / ((widths[i]! + widths[i + 1]!) ** 2);
        if (distance < best[index]!) {
          best[index] = distance;
          along[index] = (cum[i]! + (cum[i + 1]! - cum[i]!) * t) / length;
          half[index] = ((widths[i]! + (widths[i + 1]! - widths[i]!) * t) / 2) * CLEF_SCALE;
        }
      }
    }
  }
  const data = new Float32Array(width * height * 4);
  for (let index = 0; index < inside.length; index += 1) {
    const signed = inside[index]
      ? -(Math.sqrt(toOutside.distance[index]!) - 0.5)
      : Math.sqrt(toInside.distance[index]!) - 0.5;
    const source = inside[index] ? index : toInside.nearest[index]!;
    data[index * 4] = signed;
    data[index * 4 + 1] = along[source]!;
    data[index * 4 + 2] = half[source]!;
  }
  return {
    kind, width, height, data, rect, length, points, widths, cum,
    blobs: shape.blobs.map(({ at: [x, y], radius, when }) => ({ at: [x * space, y * space], radius: radius * space, when })),
    thickest: Math.max(...widths),
  };
}

// The rods as five damped strings with fixed ends, in CSS pixels.
class Strings {
  readonly y = new Float32Array(STRINGS * NODES);
  readonly v = new Float32Array(STRINGS * NODES);

  reset() {
    this.y.fill(0);
    this.v.fill(0);
  }

  step(delta: number) {
    const { y, v } = this;
    const substeps = Math.max(1, Math.ceil(delta / (1 / 120)));
    const h = delta / substeps;
    // Glass rods are stiffer than strings: they ring faster and settle sooner.
    const tension = 44 * 44;
    for (let s = 0; s < substeps; s += 1) {
      for (let k = 0; k < STRINGS; k += 1) {
        const base = k * NODES;
        for (let j = 1; j < NODES - 1; j += 1) {
          const i = base + j;
          v[i]! += (tension * (y[i - 1]! - 2 * y[i]! + y[i + 1]!) - 5 * v[i]!) * h;
        }
        for (let j = 1; j < NODES - 1; j += 1) y[base + j]! += v[base + j]! * h;
      }
    }
  }

  // Push string k at position u (0 to 1 along it) with this velocity.
  pluck(k: number, u: number, velocity: number) {
    if (k < 0 || k >= STRINGS) return;
    const center = u * (NODES - 1);
    for (let j = 1; j < NODES - 1; j += 1) this.v[k * NODES + j]! += velocity * Math.exp(-(((j - center) / 1.6) ** 2));
  }

  at(k: number, u: number) {
    const x = clamp01(u) * (NODES - 1);
    const j = Math.min(Math.floor(x), NODES - 2);
    const t = x - j;
    const base = k * NODES;
    return this.y[base + j]! * (1 - t) + this.y[base + j + 1]! * t;
  }
}

interface CopyRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Staff geometry, in CSS pixels.
interface Staff {
  width: number;
  height: number;
  space: number;
  // The staff space the background lyrics are sized to.
  text: number;
  radius: number;
  head: number;
  cy: number;
  left: number;
  right: number;
  columnLeft: number;
  columnRight: number;
}

// A shape for the shader, in CSS pixels. Capsules run from a to b (a circle
// when they meet); rings sit at a with radius `size`; arcs sit at a with
// radius `size`, spanning `span` radians each side of straight up.
interface Shape {
  kind: 0 | 1 | 2;
  a: Point;
  b: Point;
  size: number;
  span: number;
  thickness: number;
  light: number;
  blend: number;
}

// Where glass is forming and catches the light for a moment.
interface Flash {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

// A landing to ring the rods with, at phrase time `at`.
interface Landing {
  at: number;
  x: number;
  pitch: number;
  strength: number;
}

const UNIFORMS = [
  'uField', 'uStrings', 'uClef', 'uResolution', 'uDpr', 'uTime', 'uFieldWidth', 'uFieldPitch', 'uProtect', 'uStaff',
  'uRod', 'uTips', 'uWave', 'uSwell', 'uBand', 'uFigureBox', 'uFade', 'uStage', 'uPrimA', 'uPrimB', 'uPrimCount', 'uFlashes', 'uClefRect', 'uClefState',
  'uClefScale', 'uLight', 'uPointer', 'uAberration',
] as const;
type UniformName = (typeof UNIFORMS)[number];

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Glass score needs a 2D canvas');
  return context;
}

// Notes below the middle line take stems up; on or above it, down.
const stemDirection = (note: NoteSpec) => note.stem ?? (note.pitch > 0 ? 'up' : 'down');

// A spring from 0 to 1 that settles with a little overshoot, like the springs
// Liquid Glass shapes morph on; 0 until t reaches 0.
function spring(t: number, stiffness = 15, damping = 0.62) {
  if (t <= 0) return 0;
  const decay = damping * stiffness;
  const frequency = stiffness * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-decay * t) * (Math.cos(frequency * t) + (decay / frequency) * Math.sin(frequency * t));
}

// A piece of glass that forms for phrase time `at`: it starts growing FORM
// seconds before, springs to full size, and gives off most light as it forms.
function form(at: number, tau: number) {
  const since = tau - at;
  const grown = spring(tau - (at - FORM));
  return { grown, since, light: Math.min(1, grown) * (0.45 + 0.55 * Math.exp(-Math.max(since, 0) * 3.2)) };
}

export class LyricLight {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly atlas = document.createElement('canvas');
  readonly atlasContext = context2d(this.atlas);
  readonly strings = new Strings();
  readonly stringData = new Float32Array(STRINGS * NODES);
  readonly tipData = new Float32Array(STRINGS);
  readonly primA = new Float32Array(MAX_PRIMS * 4);
  readonly primB = new Float32Array(MAX_PRIMS * 4);
  readonly flashData = new Float32Array(MAX_FLASHES * 4);
  time = 0;
  // The time the strings have been simulated up to.
  simTime = -1;
  // How long the staff has been drawing in, or -1 when it is already whole.
  // Only a live start from the top draws it in; stills show it whole.
  introElapsed = -1;
  playing = false;
  visible = true;
  destroyed = false;
  lost = false;
  frame = 0;
  last = 0;
  dpr = 1;
  staff: Staff | null = null;
  clefs = new Map<'treble' | 'bass', ClefField>();
  clefLoaded: ClefField | null = null;
  prebuild = 0;
  protectRect: [left: number, top: number, right: number, bottom: number] = [0, 0, 0, 0];
  pointer = { x: 0, y: 0, goalX: 0, goalY: 0, target: 0, strength: 0, lastX: 0, lastY: 0 };
  // Where the staff was last tapped, and when, in engine time.
  tapped: { x: number; y: number; at: number } | null = null;
  quality = 1;
  slowFrames = 0;
  fontsReady = false;
  atlasKey = '';
  fieldWidth = 0;
  fieldPitch: [near: number, far: number] = [0, 0];
  onQualityChange: (() => void) | null = null;
  // Set by initGL, which also runs again after a lost context is restored.
  program!: WebGLProgram;
  uniforms!: Record<UniformName, WebGLUniformLocation | null>;
  fieldTexture!: WebGLTexture;
  stringTexture!: WebGLTexture;
  clefTexture!: WebGLTexture;
  maxTexture = 0;

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    try {
      return new LyricLight(canvas, gl);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.initGL();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    void document.fonts.load('italic 380 16px "Geist Variable"')
      .catch(() => {})
      .then(() => { this.fontsReady = true; this.atlasKey = ''; this.refresh(); });
  }

  onLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lost = true;
  };

  onRestored = () => {
    this.lost = false;
    this.initGL();
    this.atlasKey = '';
    this.refresh();
  };

  initGL() {
    const { gl } = this;
    const program = gl.createProgram();
    if (!program) throw new Error('Glass score program could not be created');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Glass score program failed to link');
    this.program = program;
    this.uniforms = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])) as Record<UniformName, WebGLUniformLocation | null>;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fieldTexture = this.createTexture(gl.REPEAT, gl.LINEAR_MIPMAP_LINEAR);
    // Half-float distance fields filter smoothly between texels.
    this.clefTexture = this.createTexture(gl.CLAMP_TO_EDGE, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1e4, 0, 0, 0]));
    // Float string data is read with texelFetch, so it never needs filtering.
    this.stringTexture = this.createTexture(gl.CLAMP_TO_EDGE, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, NODES, STRINGS, 0, gl.RED, gl.FLOAT, null);
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.clefLoaded = null;
  }

  createTexture(wrapS: GLenum, minFilter: GLenum) {
    const { gl } = this;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Glass score texture could not be created');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  // Layout comes from the DOM: the hero size and the copy block. Wide screens
  // set the figures in the column right of the copy, with the rods running in
  // from behind it. Phones put the staff above the copy.
  resize(width: number, height: number, copyRect: CopyRect, _headlineY: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.quality;
    // Phones and portrait tablets (matching the CSS aspect query) stack the staff over the copy.
    const compact = width < 720 || height > width * 1.1;
    let text;
    let space;
    let cy;
    let columnLeft;
    let columnRight;
    if (compact) {
      const top = 84;
      const room = Math.max(240, copyRect.top - 28 - top);
      columnLeft = width * 0.04;
      columnRight = width * 0.96;
      text = Math.max(13, Math.min(30, (columnRight - columnLeft) / 15, room / 11));
      space = Math.max(13, Math.min(text * SHAPE_SCALE, (columnRight - columnLeft) / FIGURE_WIDTH, room / FIGURE_HEIGHT));
      cy = top + room * 0.5;
    } else {
      columnLeft = Math.max(copyRect.right + 48, width * 0.48);
      columnRight = width - Math.max(32, width * 0.04);
      text = Math.max(20, Math.min(40, width * 0.025, (height - 72) / 13, (columnRight - columnLeft) / 15));
      space = Math.max(20, Math.min(text * SHAPE_SCALE, (height - 72) / (FIGURE_HEIGHT + 1), (columnRight - columnLeft) / FIGURE_WIDTH));
      cy = (copyRect.top + copyRect.bottom) / 2 - space * 0.6;
    }
    const staffChanged = this.staff?.space !== space;
    this.staff = {
      width, height, space, text, cy, columnLeft, columnRight,
      radius: space * 0.11,
      head: space * 0.58,
      left: -width * 0.05,
      right: width * 1.05,
    };
    if (staffChanged) {
      this.clefs.clear();
      this.clefLoaded = null;
      this.prebuildClefs();
    }
    this.protectRect = [copyRect.left, copyRect.top, copyRect.right, copyRect.bottom];
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.refresh();
  }

  // Build the next clef field the staff lacks; false once none is left to build.
  nextClef() {
    const { staff } = this;
    const kind = (['treble', 'bass'] as const).find(kind => !this.clefs.has(kind));
    if (!staff || !kind || this.destroyed) return false;
    this.clefs.set(kind, buildClef(kind, staff.space));
    return true;
  }

  // Build the clef fields soon, rather than in the frame a clef first appears:
  // one per task, so neither holds up the frames around it.
  prebuildClefs() {
    window.clearTimeout(this.prebuild);
    this.prebuild = window.setTimeout(() => {
      if (this.nextClef()) this.prebuildClefs();
    }, 120);
  }

  buildAtlas(staff: Staff) {
    const { gl, canvas, dpr } = this;
    const key = [canvas.height, staff.text, dpr].join(':');
    if (key === this.atlasKey) return;
    this.atlasKey = key;
    const width = Math.min(this.maxTexture, Math.round(2048 * dpr));
    const height = canvas.height;
    this.atlas.width = width;
    this.atlas.height = height;
    const ctx = this.atlasContext;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const nearPitch = staff.text * 0.76 * dpr;
    const farPitch = nearPitch * 0.66;
    drawLyricRows(ctx, { pitch: nearPitch, size: nearPitch * 0.62, weight: 380, color: '#f00', seed: 7 }, width, height);
    ctx.globalCompositeOperation = 'lighter';
    drawLyricRows(ctx, { pitch: farPitch, size: farPitch * 0.6, weight: 360, color: '#0f0', seed: 19 }, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, this.atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.fieldWidth = width;
    this.fieldPitch = [nearPitch, farPitch];
  }

  clef(kind: 'treble' | 'bass', staff: Staff) {
    let field = this.clefs.get(kind);
    if (!field) {
      field = buildClef(kind, staff.space);
      this.clefs.set(kind, field);
    }
    if (this.clefLoaded !== field) {
      const { gl } = this;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.clefTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field.width, field.height, 0, gl.RGBA, gl.FLOAT, field.data);
      this.clefLoaded = field;
    }
    return field;
  }

  // Where the figure starts, so it sits centred in the column.
  origin(figure: Figure, staff: Staff) {
    let left = figure.clef ? -1.2 : -0.8;
    let right = 0.8;
    for (const note of figure.notes) right = Math.max(right, note.x + 1.2);
    if (figure.barline !== undefined) right = Math.max(right, figure.barline + 1);
    if (figure.clef === 'bass') right = Math.max(right, 3.4);
    left *= staff.space;
    right *= staff.space;
    return staff.columnLeft + (staff.columnRight - staff.columnLeft - (right - left)) / 2 - left;
  }

  // The staff's travelling wave: a long swell moving left to right with a
  // shorter one over it. Amplitude in CSS pixels, wavenumber per CSS pixel,
  // phase in radians; the shader evaluates the same two terms.
  waves(time: number) {
    const staff = this.staff!;
    return [
      [staff.space * 0.16, (Math.PI * 2) / (staff.width * 1.3), time * 0.5],
      [staff.space * 0.05, (Math.PI * 2) / (staff.width * 0.45), time * 0.9 - 1.3],
    ] as const;
  }

  wave(x: number, time: number) {
    let offset = 0;
    for (const [amplitude, k, phase] of this.waves(time)) offset += amplitude * Math.sin(k * x - phase);
    return offset;
  }

  along(x: number) {
    const staff = this.staff!;
    return (x - staff.left) / (staff.right - staff.left);
  }

  // How far rod k has drawn in while the staff is strung, from 0 to 1. It
  // sweeps quickly through the copy and slows as it reaches the far edge.
  drawn(k: number) {
    if (this.introElapsed < 0) return 1;
    return easeOut(clamp01((this.introElapsed - k * INTRO_STAGGER) / INTRO));
  }

  // While the staff is strung, rod k ripples like a loose ribbon: a wave runs
  // along it left to right, strongest clear of the copy, and eases away as the
  // rod pulls taut. Neighbouring rods run a little out of step, never enough
  // to cross. In CSS pixels.
  ripple(k: number, x: number) {
    const elapsed = this.introElapsed;
    const start = k * INTRO_STAGGER;
    const taut = start + INTRO - TAUT_EARLY;
    if (elapsed < 0 || elapsed > taut + TAUT * 2.5) return 0;
    const staff = this.staff!;
    const loose = smooth(start, start + 0.5, elapsed) * Math.exp(-((Math.max(elapsed - taut, 0) / TAUT) ** 2));
    const wavelength = Math.max(staff.width * 0.45, staff.space * 10);
    const phase = (Math.PI * 2 * (x - staff.left)) / wavelength - 5.4 * elapsed + k * 0.42;
    return staff.space * 0.85 * loose * smooth(staff.left, staff.columnLeft, x) * Math.sin(phase);
  }

  // How far rod k is from rest at x: its vibration, and its ripple while the staff is strung.
  shift(k: number, x: number) {
    return this.strings.at(k, this.along(x)) + this.ripple(k, x);
  }

  rodY(k: number, x: number, time: number) {
    const staff = this.staff!;
    return staff.cy + (k - 2) * staff.space + this.wave(x, time) + this.shift(k, x);
  }

  // Where a note rests: its staff position, riding the nearest rod.
  restY(x: number, pitch: number, time: number) {
    const staff = this.staff!;
    const rod = Math.min(4, Math.max(0, Math.round(2 + pitch / 2)));
    return staff.cy + (pitch * staff.space) / 2 + this.wave(x, time) + this.shift(rod, x);
  }

  // Everything in a figure that rings the rods, in phrase time.
  landings(figure: Figure, staff: Staff): Landing[] {
    const origin = this.origin(figure, staff);
    const list: Landing[] = figure.notes.map(note => ({ at: note.at, x: origin + note.x * staff.space, pitch: note.pitch, strength: 34 }));
    if (figure.clef) {
      // A finished clef strums the staff where it stands.
      for (let pitch = -4; pitch <= 4; pitch += 2) list.push({ at: POUR_END, x: origin + staff.space * 0.6, pitch, strength: 14 });
    }
    return list;
  }

  ring(landing: Landing) {
    const rod = 2 + Math.floor(landing.pitch / 2);
    const u = this.along(landing.x);
    if (landing.pitch % 2 === 0) this.strings.pluck(rod, u, landing.strength);
    else {
      this.strings.pluck(rod, u, landing.strength * 0.65);
      this.strings.pluck(rod + 1, u, landing.strength * 0.65);
    }
  }

  // Step the strings from simTime to `time`, ringing them for anything that lands on the way.
  advance(time: number, figure: Figure, staff: Staff) {
    const phraseStart = Math.floor(time / PHRASE_LENGTH) * PHRASE_LENGTH;
    if (this.simTime < 0 || this.simTime > time + 1e-6 || time - this.simTime > 0.25) {
      // A jump (a still, a seek): replay this phrase from rest so the result
      // is the same however the moment was reached.
      this.strings.reset();
      this.simTime = phraseStart;
    }
    const landings = this.landings(figure, staff);
    while (this.simTime < time - 1e-6) {
      const next = Math.min(time, this.simTime + 1 / 60);
      const from = this.simTime - phraseStart;
      const to = next - phraseStart;
      for (const landing of landings) {
        if (landing.at > from && landing.at <= to) this.ring(landing);
      }
      this.strings.step(next - this.simTime);
      this.simTime = next;
    }
  }

  // A note head at phrase time tau: it swells out of the rod it belongs to and
  // springs into place, then sinks back into that rod as the figure melts.
  head(x: number, pitch: number, at: number, tau: number, time: number, sunk: number) {
    const rod = Math.min(4, Math.max(0, Math.round(2 + pitch / 2)));
    const { grown, light: given, since } = form(at, tau);
    const line = this.rodY(rod, x, time);
    let y = line + (this.restY(x, pitch, time) - line) * grown;
    let scale = grown;
    let light = given;
    if (sunk > 0) {
      const settle = sunk * sunk * (3 - 2 * sunk);
      y += (line - y) * settle;
      scale *= 1 - settle;
      light *= 1 - sunk;
    }
    return { y, scale, light, since };
  }

  // The figure's shapes and flashes at phrase time tau.
  shapes(figure: Figure, staff: Staff, tau: number, time: number) {
    const { space } = staff;
    const origin = this.origin(figure, staff);
    const sunk = melt(tau);
    const fading = 1 - sunk;
    const shapes: Shape[] = [];
    const flashes: Flash[] = [];
    // Zero-radius shapes still leave a bump where their smooth joins meet a
    // rod. Once the melt finishes, leave only the staff for the next phrase.
    if (sunk >= 1) return { shapes, flashes, clef: null };
    const remaining = 1 - easeInOut(sunk);
    const circle = (x: number, y: number, radius: number, light: number, blend = space * 0.42): Shape =>
      ({ kind: 0, a: [x, y], b: [x, y], size: 0, span: 0, thickness: radius, light, blend });
    const capsule = (a: Point, b: Point, radius: number, light: number, blend = space * 0.12): Shape =>
      ({ kind: 0, a, b, size: 0, span: 0, thickness: radius, light, blend });
    // The light rises as the glass forms and fades once it has settled.
    const addFlash = (x: number, y: number, radius: number, since: number) => {
      const t = (since + FORM) / (FORM + 0.6);
      if (t > 0 && t < 1) flashes.push({ x, y, radius: radius * 2, alpha: Math.sin(Math.PI * t) * 0.9 });
    };
    // Springs from 0 to 1 once `start` is reached, settling in about
    // `duration`, and goes back to 0 as the figure melts.
    const grown = (start: number, duration = GROW) => Math.min(spring(tau - start, 5 / duration, 0.7), 1.04) * remaining;

    const stems: Point[] = [];
    const heads = figure.notes.map(note => {
      const x = origin + note.x * space;
      const state = this.head(x, note.pitch, note.at, tau, time, sunk);
      return { note, x, ...state };
    });
    for (const { note, x, y, scale, light, since } of heads) {
      if (tau < note.at - FORM) continue;
      const radius = staff.head * scale;
      if (note.hollow) {
        // A hollow head is a glass ring.
        shapes.push({ kind: 1, a: [x, y], b: [x, y], size: radius * 0.68, span: 0, thickness: radius * 0.32, light, blend: space * 0.14 * Math.min(scale, 1) });
      } else shapes.push(circle(x, y, radius, light, space * 0.16 * Math.min(scale, 1)));
      addFlash(x, y, staff.head, since);
      const direction = stemDirection(note);
      if (direction === 'none') continue;
      const grow = grown(note.at + STEM_DELAY);
      if (grow <= 0.001) continue;
      const up = direction === 'up';
      const stemX = x + (up ? 1 : -1) * radius * 0.86;
      const length = space * 3.3;
      const from: Point = [stemX, y + (up ? -0.1 : 0.1) * space];
      const to: Point = [stemX, from[1] + (up ? -1 : 1) * length * grow];
      shapes.push(capsule(from, to, space * 0.1 * remaining, light * 0.7, space * 0.12 * remaining));
      stems.push(to);
    }

    if (figure.beam && stems.length > 1) {
      const first = stems[0]!;
      const last = stems.at(-1)!;
      const grow = grown(settledAt(figure) - 0.1, 0.45);
      if (grow > 0.001) {
        const end: Point = [first[0] + (last[0] - first[0]) * grow, first[1] + (last[1] - first[1]) * grow];
        shapes.push(capsule(first, end, space * 0.27 * remaining, 0.6 * fading, space * 0.16 * remaining));
      }
    }

    if (figure.fermata !== undefined) {
      const held = heads[figure.fermata];
      if (held) {
        const start = held.note.at + 0.5;
        const grow = grown(start, 0.7);
        const crownY = this.rodY(0, held.x, time) - space * 1.1;
        if (grow > 0.001) {
          shapes.push({ kind: 2, a: [held.x, crownY + space * 1.2], b: [held.x, 0], size: space * 1.2, span: 1.5 * grow, thickness: space * 0.22 * remaining, light: 0.6 * fading, blend: space * 0.14 * remaining });
        }
        const dotAt = start + 0.75;
        if (tau >= dotAt - FORM) {
          const dot = form(dotAt, tau);
          const dotY = crownY + space * 0.78;
          shapes.push(circle(held.x, dotY, space * 0.24 * dot.grown * remaining, dot.light * fading, space * 0.2 * remaining));
          addFlash(held.x, dotY, space * 0.3, dot.since);
        }
      }
    }

    if (figure.barline !== undefined) {
      const x = origin + figure.barline * space;
      // The bar line closes the figure once everything else has formed.
      const start = Math.max(settledAt(figure) + 0.3, figure.fermata === undefined ? 0 : 3.4);
      [[0, space * 0.07, 0], [space * 0.5, space * 0.2, 0.18]].forEach(([dx, radius, delay]) => {
        const grow = grown(start + delay!, 0.5);
        if (grow <= 0.001) return;
        const top: Point = [x + dx!, this.rodY(0, x, time)];
        const bottom: Point = [x + dx!, top[1] + (this.rodY(4, x, time) - top[1]) * grow];
        shapes.push(capsule(top, bottom, radius! * remaining, 0.45 * fading, space * 0.1 * remaining));
      });
    }

    let clef: { field: ClefField; x: number; y: number; progress: number; thin: number; light: number } | null = null;
    if (figure.clef && tau > POUR_START) {
      const field = this.clef(figure.clef, staff);
      const x = origin;
      const y = staff.cy + this.wave(x, time) + this.ripple(2, x);
      // The clef pours along its stroke, and in the melt drains back the way it
      // came, thinning a little as it goes.
      const progress = easeInOut(clamp01((tau - POUR_START) / (POUR_END - POUR_START))) * remaining;
      const thin = easeInOut(sunk) * field.thickest * 0.2;
      const shimmer = 0.06 * Math.sin(time * 1.7);
      clef = { field, x, y, progress, thin, light: (progress > 0 ? 0.6 + shimmer : 0) * fading };
      // The glass catches the light where the stroke is being written.
      if (progress > 0.002 && progress < 0.998) {
        const [px, py] = this.pointOnClef(field, progress);
        const presence = smooth(0, 0.06, progress) * smooth(1, 0.94, progress);
        flashes.push({ x: x + px, y: y + py, radius: space * 1.1, alpha: presence * 0.9 });
      }
      for (const blob of field.blobs) {
        const [bx, by] = blob.at;
        if (blob.when === 'after') {
          // The bass clef's dots form once the stroke is written.
          const at = POUR_END + 0.2 + field.blobs.indexOf(blob) * 0.18;
          if (tau < at - FORM) continue;
          const dot = form(at, tau);
          shapes.push(circle(x + bx, y + by, blob.radius * dot.grown * remaining, dot.light * fading, space * 0.2 * remaining));
          addFlash(x + bx, y + by, blob.radius * 1.4, dot.since);
          continue;
        }
        const show = blob.when === 'start' ? smooth(0, 0.08, progress) : smooth(0.93, 1, progress);
        if (show <= 0.001) continue;
        shapes.push(circle(x + bx, y + by, blob.radius * show * remaining, 0.6 * fading, space * 0.25 * remaining));
      }
    }
    return { shapes: shapes.filter(shape => shape.thickness > 0.001).slice(0, MAX_PRIMS), flashes: flashes.slice(0, MAX_FLASHES), clef };
  }

  // The area the figure, its light and its blend into the rods can reach, in
  // CSS pixels, so the shader can skip the figure everywhere else.
  figureBox(shapes: Shape[], clef: { field: ClefField; x: number; y: number } | null): [number, number, number, number] {
    const staff = this.staff!;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    const include = (x: number, y: number, radius: number) => {
      minX = Math.min(minX, x - radius);
      minY = Math.min(minY, y - radius);
      maxX = Math.max(maxX, x + radius);
      maxY = Math.max(maxY, y + radius);
    };
    for (const shape of shapes) {
      const reach = shape.kind === 0 ? shape.thickness : shape.size + shape.thickness;
      include(shape.a[0], shape.a[1], reach + shape.blend);
      if (shape.kind === 0) include(shape.b[0], shape.b[1], reach + shape.blend);
    }
    if (clef) {
      const [x, y, width, height] = clef.field.rect;
      minX = Math.min(minX, clef.x + x);
      minY = Math.min(minY, clef.y + y);
      maxX = Math.max(maxX, clef.x + x + width);
      maxY = Math.max(maxY, clef.y + y + height);
    }
    if (minX > maxX) return [1e6, 1e6, -1e6, -1e6];
    // Light reaches about four falloffs beyond the glass.
    const margin = staff.space * 3.4;
    return [minX - margin, minY - margin, maxX + margin, maxY + margin];
  }

  // Point and stroke width at `progress` along a clef's stroke.
  pointOnClef(field: ClefField, progress: number): [x: number, y: number, width: number] {
    const target = progress * field.length;
    const { cum, points, widths } = field;
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < target) i += 1;
    const span = cum[i]! - cum[i - 1]! || 1;
    const t = clamp01((target - cum[i - 1]!) / span);
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, widths[i - 1]! + (widths[i]! - widths[i - 1]!) * t];
  }

  // Whether the staff is still being strung, with the score holding.
  get stringing() {
    return this.introElapsed >= 0 && this.introElapsed < INTRO_HOLD;
  }

  // Plucks rods the cursor crosses, as a player would.
  strum(time: number, delta: number) {
    const { pointer, staff } = this;
    if (!staff || pointer.target === 0 || delta <= 0) return;
    const { goalX: x, goalY: y, lastX, lastY } = pointer;
    pointer.lastX = x;
    pointer.lastY = y;
    if (Math.abs(y - lastY) < 0.5 || this.stringing) return;
    const u = this.along(x);
    for (let k = 0; k < STRINGS; k += 1) {
      const before = lastY - this.rodY(k, lastX, time);
      const after = y - this.rodY(k, x, time);
      if (before * after < 0) {
        const speed = Math.max(-180, Math.min(180, ((y - lastY) / delta) * 0.3));
        this.strings.pluck(k, u, speed);
      }
    }
  }

  render(delta = 0) {
    const { staff } = this;
    if (this.destroyed || this.lost || !staff || !this.fontsReady || !this.canvas.width) return;
    this.buildAtlas(staff);
    const time = this.time;
    const tau = time % PHRASE_LENGTH;
    const figure = figures[Math.floor(time / PHRASE_LENGTH) % phraseCount]!;
    if (delta > 0) this.strum(time, delta);
    this.advance(time, figure, staff);
    const { gl, dpr, uniforms: u } = this;

    for (let k = 0; k < STRINGS; k += 1) {
      for (let j = 0; j < NODES; j += 1) {
        const x = staff.left + ((staff.right - staff.left) * j) / (NODES - 1);
        this.stringData[k * NODES + j] = (this.strings.y[k * NODES + j]! + this.ripple(k, x)) * dpr;
      }
      const drawn = this.drawn(k);
      this.tipData[k] = drawn < 1 ? (staff.left + (staff.right - staff.left) * drawn) * dpr : 1e7;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.stringTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NODES, STRINGS, gl.RED, gl.FLOAT, this.stringData);

    const { shapes, flashes, clef } = this.shapes(figure, staff, tau, time);
    this.primA.fill(0);
    this.primB.fill(0);
    shapes.forEach((shape, i) => {
      if (shape.kind === 0) this.primA.set([shape.a[0] * dpr, shape.a[1] * dpr, shape.b[0] * dpr, shape.b[1] * dpr], i * 4);
      else this.primA.set([shape.a[0] * dpr, shape.a[1] * dpr, shape.size * dpr, shape.span], i * 4);
      this.primB.set([shape.thickness * dpr, shape.kind, shape.light, shape.blend * dpr], i * 4);
    });
    // A tapped rod catches the light where it was touched.
    if (this.tapped && time - this.tapped.at < 0.6 && flashes.length < MAX_FLASHES) {
      const t = (time - this.tapped.at) / 0.6;
      flashes.push({ x: this.tapped.x, y: this.tapped.y, radius: staff.space * 1.2, alpha: (1 - t) ** 2 });
    }
    this.flashData.fill(0);
    flashes.forEach(({ x, y, radius, alpha }, i) => this.flashData.set([x * dpr, y * dpr, radius * dpr, alpha], i * 4));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.clefTexture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform1i(u.uField, 0);
    gl.uniform1i(u.uStrings, 2);
    gl.uniform1i(u.uClef, 3);
    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uFieldWidth, this.fieldWidth);
    gl.uniform2f(u.uFieldPitch, this.fieldPitch[0], this.fieldPitch[1]);
    const [left, top, right, bottom] = this.protectRect;
    gl.uniform4f(u.uProtect, left * dpr, top * dpr, right * dpr, bottom * dpr);
    gl.uniform4f(u.uStaff, staff.left * dpr, staff.right * dpr, staff.cy * dpr, staff.space * dpr);
    // How far the last rod has drawn in.
    const intro = this.drawn(STRINGS - 1);
    // The rim band: Liquid Glass bends light only in a narrow band at the edge.
    gl.uniform3f(u.uRod, staff.radius * dpr, staff.space * 0.22 * dpr, intro);
    gl.uniform1fv(u.uTips, this.tipData);
    const [[amplitude, k, phase], [swell, swellK, swellPhase]] = this.waves(time);
    gl.uniform3f(u.uWave, amplitude * dpr, k / dpr, phase);
    gl.uniform3f(u.uSwell, swell * dpr, swellK / dpr, swellPhase);
    gl.uniform2f(u.uBand, (staff.cy - staff.space * 8.5) * dpr, (staff.cy + staff.space * 8) * dpr);
    gl.uniform1f(u.uFade, this.introElapsed >= 0 ? smooth(0, FADE_IN, this.introElapsed) : 1);
    const box = this.figureBox(shapes, clef);
    gl.uniform4f(u.uFigureBox, box[0] * dpr, box[1] * dpr, box[2] * dpr, box[3] * dpr);
    const columnCenter = (staff.columnLeft + staff.columnRight) / 2;
    gl.uniform4f(u.uStage, columnCenter * dpr, staff.cy * dpr, (staff.columnRight - staff.columnLeft) * 0.62 * dpr, staff.space * 5 * dpr);
    gl.uniform4fv(u.uPrimA, this.primA);
    gl.uniform4fv(u.uPrimB, this.primB);
    gl.uniform1i(u.uPrimCount, shapes.length);
    gl.uniform4fv(u.uFlashes, this.flashData);
    if (clef) {
      const { field } = clef;
      gl.uniform4f(u.uClefRect, (clef.x + field.rect[0]) * dpr, (clef.y + field.rect[1]) * dpr, field.rect[2] * dpr, field.rect[3] * dpr);
      gl.uniform4f(u.uClefState, clef.progress, clef.thin * dpr, clef.light, field.length * dpr);
      gl.uniform1f(u.uClefScale, dpr / CLEF_SCALE);
    } else gl.uniform1f(u.uClefScale, 0);

    // The key light sits up and to the left, swaying a little; a cursor over
    // the hero draws it towards itself.
    const angle = -2.2 + 0.22 * Math.sin(time * 0.3);
    let lightX = Math.cos(angle);
    let lightY = Math.sin(angle);
    const { pointer } = this;
    if (pointer.strength > 0.01) {
      const towardX = pointer.x - columnCenter;
      const towardY = pointer.y - staff.cy;
      const length = Math.hypot(towardX, towardY) || 1;
      const pull = pointer.strength / 0.55;
      lightX += (towardX / length - lightX) * pull;
      lightY += (towardY / length - lightY) * pull;
    }
    const lightLength = Math.hypot(lightX, lightY) || 1;
    const sweepAt = sweep(tau);
    const sweepX = sweepAt === null ? -1e7 : (-240 + (staff.width + 480) * sweepAt) * dpr;
    // The staff's own light comes up with the intro.
    gl.uniform4f(u.uLight, lightX / lightLength, lightY / lightLength, sweepX, 0.1 * intro);
    gl.uniform3f(u.uPointer, pointer.x * dpr, pointer.y * dpr, pointer.strength);
    // The colour split is widest while the figure forms and while it melts.
    gl.uniform1f(u.uAberration, 0.12 + 0.12 * Math.max(1 - smooth(1.0, 3.2, tau), smooth(7.2, 8.6, tau)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  tick = (now: DOMHighResTimeStamp) => {
    this.frame = 0;
    if (!this.playing || !this.visible) return;
    const delta = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    const step = Math.min(delta, 0.05);
    // The score holds on the empty staff while it is strung.
    if (!this.stringing) this.time += step;
    if (this.introElapsed >= 0) this.introElapsed += step;
    const ease = 1 - Math.exp(-step * 6);
    this.pointer.strength += (this.pointer.target - this.pointer.strength) * ease;
    this.pointer.x += (this.pointer.goalX - this.pointer.x) * ease * 1.4;
    this.pointer.y += (this.pointer.goalY - this.pointer.y) * ease * 1.4;
    this.render(step);
    this.adapt(delta);
    this.frame = requestAnimationFrame(this.tick);
  };

  // Drop resolution on hardware that cannot hold a smooth frame rate.
  adapt(delta: number) {
    if (!delta) return;
    this.slowFrames = delta > 0.028 ? this.slowFrames + 2 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.quality > 0.6) {
      this.slowFrames = 0;
      this.quality = this.quality > 0.8 ? 0.8 : 0.6;
      this.onQualityChange?.();
    }
  }

  schedule() {
    if (this.playing && this.visible && !this.lost && !this.frame) {
      this.last = 0;
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  refresh() {
    if (this.playing && this.visible) this.schedule();
    else this.render();
  }

  setPlaying(playing: boolean) {
    if (playing && !this.playing && this.time === 0 && this.introElapsed < 0) {
      // Begin on the empty staff at the end of the last figure, so the staff
      // is strung and the first clef pours as the rods settle.
      this.introElapsed = 0;
      this.time = phraseCount * PHRASE_LENGTH - LEAD;
      // Build the clefs first, so nothing interrupts the staff being strung.
      while (this.nextClef()) continue;
    }
    this.playing = playing;
    if (!playing) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pointer.strength = 0;
      this.pointer.target = 0;
    }
    this.refresh();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.schedule();
  }

  setTime(time: number) {
    this.time = time;
    this.refresh();
  }

  // A tap or click near the staff plucks the nearest rod, for touch screens
  // where there is no cursor to strum with.
  tap(x: number, y: number) {
    const { staff } = this;
    if (!staff || !this.playing || this.stringing) return false;
    let nearest = -1;
    let distance = Infinity;
    for (let k = 0; k < STRINGS; k += 1) {
      const d = Math.abs(y - this.rodY(k, x, this.time));
      if (d < distance) {
        distance = d;
        nearest = k;
      }
    }
    if (distance > staff.space * 0.9) return false;
    this.strings.pluck(nearest, this.along(x), y < this.rodY(nearest, x, this.time) ? 150 : -150);
    this.tapped = { x, y: this.rodY(nearest, x, this.time), at: this.time };
    return true;
  }

  setPointer(x: number, y: number, active: boolean) {
    if (active && this.pointer.target === 0) {
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.lastX = x;
      this.pointer.lastY = y;
    }
    this.pointer.goalX = x;
    this.pointer.goalY = y;
    this.pointer.target = active ? 0.55 : 0;
  }

  // Release GPU resources but keep the context: React may remount on the same canvas.
  destroy() {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.prebuild);
    this.destroyed = true;
    this.playing = false;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const { gl } = this;
    gl.deleteTexture(this.fieldTexture);
    gl.deleteTexture(this.stringTexture);
    gl.deleteTexture(this.clefTexture);
    gl.deleteProgram(this.program);
  }
}
