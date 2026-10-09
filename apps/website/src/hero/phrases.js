// Each phrase is one musical figure drawn in light: the staff is traced, the
// symbol forms, the light holds, then dims to darkness before the next phrase.
// Geometry is authored in staff spaces (the distance between two staff lines)
// so every figure keeps its proportions from phone to wide desktop.

export const PHRASE_LENGTH = 12.6;
export const RELEASE_START = 9.6;
export const RELEASE_END = 11.8;
export const STILL_TIME = 6.8;

const clamp01 = value => Math.min(1, Math.max(0, value));
const smooth = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Global light level for a phrase: quick ignition, steady sustain with a slow
// breath, then a long release into darkness.
export function envelope(tau) {
  const attack = smooth(0.35, 1.0, tau);
  const release = 1 - smooth(RELEASE_START, RELEASE_END, tau);
  const breath = 1 + 0.06 * Math.sin(tau * 1.25) * smooth(4.5, 6, tau);
  return attack * release * breath;
}

export function progressOf(element, tau) {
  return easeInOut(clamp01((tau - element.t0) / element.dur));
}

function cumulative(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    lengths.push(lengths[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  return lengths;
}

function stroke(points, options) {
  const cum = cumulative(points);
  return { kind: 'stroke', points, cum, total: cum[cum.length - 1], head: true, ...options };
}

// Five staff lines that follow a centre curve and fan by `spread`.
function staffLines(layout, { center, spread = () => 1, from = -0.04, to = 1.04, t0 = 0.6, dur = 3.0 }) {
  const { width, cy, unit } = layout;
  const lines = [];
  for (let line = -2; line <= 2; line += 1) {
    const points = [];
    const steps = Math.max(24, Math.round(((to - from) * width) / 7));
    for (let step = 0; step <= steps; step += 1) {
      const xn = from + ((to - from) * step) / steps;
      points.push([xn * width, cy + (center(xn) + line * spread(xn)) * unit]);
    }
    lines.push(stroke(points, { width: 0.36 * unit, t0: t0 + (line + 2) * 0.1, dur, staff: line + 2 }));
  }
  return lines;
}

// Frame for a symbol sitting on the staff at normalised x.
// Every figure sits in the music column to the right of the copy. On phones
// the copy sits below the light, so the figures simply favour the right half.
function rightColumn(layout, leftReach) {
  const start = layout.compact ? 0.32 : layout.copyRight + 0.04;
  return start + (leftReach * layout.unit) / layout.width;
}

function frameAt(layout, staff, xn, scale = 1) {
  const { width, cy, unit } = layout;
  const spread = staff.spread ? staff.spread(xn) : 1;
  const delta = 0.002;
  const slope = ((staff.center(xn + delta) - staff.center(xn - delta)) * unit) / (2 * delta * width);
  return {
    x: xn * width,
    y: cy + staff.center(xn) * unit,
    size: unit * spread * scale,
    rotation: Math.atan(slope),
  };
}

function place(frame, [x, y]) {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  return [frame.x + (x * cos - y * sin) * frame.size, frame.y + (x * sin + y * cos) * frame.size];
}

function bezierPath(frame, start, curves, segments = 22) {
  const points = [place(frame, start)];
  let [x0, y0] = start;
  for (const [c1x, c1y, c2x, c2y, x, y] of curves) {
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      const u = 1 - t;
      const px = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x;
      const py = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y;
      points.push(place(frame, [px, py]));
    }
    x0 = x;
    y0 = y;
  }
  return points;
}

function blob(frame, [x, y], rx, ry, options = {}) {
  const [cx, cy] = place(frame, [x, y]);
  return { kind: 'blob', x: cx, y: cy, rx: rx * frame.size, ry: ry * frame.size, rotation: frame.rotation + (options.tilt || 0), ...options };
}

// Thick-thin profile for engraved symbols, in staff spaces.
const swell = (thin, thick, peak = 0.5) => t => {
  const s = t < peak ? (t / peak) * 0.5 : 0.5 + ((t - peak) / (1 - peak)) * 0.5;
  return thin + (thick - thin) * Math.sin(Math.PI * s);
};

function bassClef(layout) {
  const staff = {
    center: xn => 0.7 - 2.8 * smooth(0.42, 1.08, xn) + 0.45 * Math.sin(xn * Math.PI * 1.25),
    spread: xn => 1 + 0.3 * xn,
  };
  const frame = frameAt(layout, staff, rightColumn(layout, 1.4), 1.9);
  const curve = bezierPath(frame, [0.12, -1.28], [
    [0.05, -2.3, 1.95, -2.55, 2.12, -1.15],
    [2.3, 0.45, 1.0, 1.95, -0.55, 2.8],
  ]);
  const w = swell(0.14, 0.7, 0.42);
  return [
    ...staffLines(layout, staff),
    blob(frame, [0.2, -0.98], 0.5, 0.5, { t0: 2.0, dur: 0.5 }),
    stroke(curve, { widthAt: t => w(t) * frame.size, t0: 2.1, dur: 1.9 }),
    blob(frame, [2.85, -1.5], 0.24, 0.24, { t0: 3.9, dur: 0.4 }),
    blob(frame, [2.85, -0.5], 0.24, 0.24, { t0: 4.1, dur: 0.4 }),
  ];
}

function trebleClef(layout) {
  const staff = { center: () => 0 };
  const frame = frameAt(layout, staff, rightColumn(layout, 1.8), 1.2);
  const curve = bezierPath(frame, [0.28, 1.02], [
    [-0.3, 1.0, -0.38, 0.2, 0.2, 0.12],
    [1.12, 0.08, 1.2, 1.78, 0.15, 1.88],
    [-1.05, 1.95, -1.35, 0.62, -0.62, -0.32],
    [0.02, -1.12, 0.88, -1.82, 0.82, -2.92],
    [0.76, -3.72, 0.2, -3.82, 0.04, -3.1],
    [-0.16, -2.4, 0.1, 0.5, 0.36, 2.92],
    [0.46, 3.72, -0.3, 4.02, -0.56, 3.46],
  ]);
  const w = t => 1.45 * (0.13 + 0.3 * Math.pow(Math.sin(Math.PI * clamp01((t - 0.18) / 0.36)), 1.4) + 0.12 * Math.pow(Math.sin(Math.PI * clamp01((t - 0.62) / 0.24)), 2)) * frame.size;
  return [
    ...staffLines(layout, staff),
    stroke(curve, { widthAt: w, t0: 2.2, dur: 2.2 }),
    blob(frame, [-0.42, 3.3], 0.36, 0.36, { t0: 4.3, dur: 0.4 }),
  ];
}

function beamedNotes(layout) {
  const staff = { center: xn => -0.7 * Math.sin(Math.PI * xn) };
  const { unit, width } = layout;
  // Clear of the copy on wide screens, where the staff runs behind it.
  const start = rightColumn(layout, 4.6);
  const groupX = Math.max(start, Math.min(1 - (5.6 * unit) / width, (start + 1) / 2));
  const offsets = [-3.9, -1.3, 1.3, 3.9];
  const pitches = [1.5, 0.5, -0.5, 0];
  const notes = offsets.map((offset, index) => {
    const xn = groupX + (offset * unit) / width;
    const frame = frameAt(layout, staff, xn, 1);
    const [x, y] = place(frame, [0, pitches[index]]);
    return { x, y, frame };
  });
  const stemLength = 3.9 * unit;
  const first = notes[0];
  const last = notes[notes.length - 1];
  const stemX = note => note.x + 0.86 * unit;
  const beamY = x => {
    const t = (x - stemX(first)) / (stemX(last) - stemX(first));
    return first.y - stemLength + t * (last.y - first.y);
  };
  const beat = 0.6;
  const elements = notes.flatMap((note, index) => {
    const top = beamY(stemX(note));
    return [
      blob(note.frame, [0, pitches[index]], 0.95, 0.68, {
        solid: true,
        tilt: -0.38, t0: 3.0 + index * 0.32, dur: 0.45,
        pulse: tau => {
          const since = tau - 5.4 - index * beat;
          return since < 0 ? 0 : Math.exp(-(since % (4 * beat)) * 4.5);
        },
      }),
      stroke([[stemX(note), note.y - 0.12 * unit], [stemX(note), top]], { width: 0.2 * unit, t0: 3.9 + index * 0.12, dur: 0.5 }),
    ];
  });
  elements.push(stroke([[stemX(first), beamY(stemX(first))], [stemX(last), beamY(stemX(last))]], { width: 0.62 * unit, t0: 4.5, dur: 0.7 }));
  return [...staffLines(layout, staff), ...elements];
}

function fermata(layout) {
  const staff = { center: xn => 1.5 * Math.sin(Math.PI * 3 * xn + 0.4) * Math.exp(-2.2 * xn) };
  const { unit, width } = layout;
  const bar = Math.max(layout.compact ? 0.82 : 0.86, rightColumn(layout, 2.8));
  const lines = staffLines(layout, { ...staff, to: bar, dur: 2.8 });
  const barFrame = frameAt(layout, staff, bar, 1);
  const thinFrame = frameAt(layout, staff, bar - (0.62 * unit) / width, 1);
  const arcFrame = frameAt(layout, staff, bar - (0.3 * unit) / width, 1);
  const arc = bezierPath(arcFrame, [-1.75, -3.0], [
    [-1.7, -4.25, -0.9, -4.9, 0, -4.9],
    [0.9, -4.9, 1.7, -4.25, 1.75, -3.0],
  ]);
  const w = swell(0.12, 0.56, 0.5);
  return [
    ...lines,
    stroke([place(thinFrame, [0, -2]), place(thinFrame, [0, 2])], { width: 0.14 * unit, t0: 3.3, dur: 0.45, head: false }),
    stroke([place(barFrame, [0, -2]), place(barFrame, [0, 2])], { width: 0.44 * unit, t0: 3.45, dur: 0.45, head: false }),
    stroke(arc, { widthAt: t => w(t) * arcFrame.size, t0: 4.0, dur: 1.1 }),
    blob(arcFrame, [0, -3.38], 0.36, 0.36, { t0: 4.9, dur: 0.4 }),
  ];
}

export const phraseNames = ['Bass clef', 'Treble clef', 'Beamed notes', 'Fermata'];
const builders = [bassClef, trebleClef, beamedNotes, fermata];
export const phraseCount = builders.length;

export function buildPhrase(index, layout) {
  return builders[index % builders.length](layout);
}
