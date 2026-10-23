// The hero's score. Each phrase is one musical figure set in glass on the
// staff: a clef is written along its own stroke, notes swell out of the rods
// and grow their stems, beams and marks spring across, it holds, then
// everything melts back into the staff before the next phrase.
//
// Positions are in staff spaces (the distance between two staff lines). x runs
// from the figure's start; pitch counts half spaces from the middle line, with
// negative numbers higher.

export type Point = [x: number, y: number];

export interface NoteSpec {
  x: number;
  pitch: number;
  // When the note lands, in seconds into the phrase.
  at: number;
  stem?: 'up' | 'down' | 'none';
  hollow?: boolean;
}

export interface Figure {
  name: string;
  clef?: 'treble' | 'bass';
  notes: NoteSpec[];
  // Beam every note's stem together, poured after the last stem grows.
  beam?: boolean;
  // Index of the note held under a fermata.
  fermata?: number;
  // Where a closing double bar line stands.
  barline?: number;
}

export const figures: Figure[] = [
  {
    name: 'Treble clef',
    clef: 'treble',
    notes: [
      { x: 4.4, pitch: 1, at: 2.9 },
      { x: 6.9, pitch: -1, at: 3.45 },
      { x: 9.4, pitch: 0, at: 4.0 },
      { x: 11.9, pitch: 2, at: 4.55 },
    ],
  },
  {
    name: 'Bass clef',
    clef: 'bass',
    notes: [
      { x: 5.6, pitch: -1, at: 3.0, hollow: true },
      { x: 8.6, pitch: 1, at: 3.7, hollow: true },
      { x: 11.4, pitch: -2, at: 4.4 },
    ],
  },
  {
    name: 'Beamed notes',
    notes: [
      { x: 0, pitch: 3, at: 1.2, stem: 'up' },
      { x: 2.6, pitch: 2, at: 1.65, stem: 'up' },
      { x: 5.2, pitch: 1, at: 2.1, stem: 'up' },
      { x: 7.8, pitch: -1, at: 2.55, stem: 'up' },
    ],
    beam: true,
  },
  {
    name: 'Fermata',
    notes: [{ x: 2.5, pitch: 0, at: 1.5, stem: 'none', hollow: true }],
    fermata: 0,
    barline: 7.5,
  },
];

export const phraseCount = figures.length;
export const phraseNames = figures.map(({ name }) => name);

// Phrase timeline, in seconds.
export const PHRASE_LENGTH = 10;
// A clef pours along its stroke between these times.
export const POUR_START = 0.3;
export const POUR_END = 2.5;
// Everything melts back into the staff, slowly enough to read as liquid.
export const RELEASE_START = 7.6;
export const RELEASE_END = 9.6;
// Reduced motion and paused stills show the figure whole.
export const STILL_TIME = 6.8;
// A note starts forming this long before its time, swelling out of the staff.
export const FORM = 0.3;
// A stem starts growing this long after its note lands, and takes GROW to reach full length.
export const STEM_DELAY = 0.12;
export const GROW = 0.36;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// How far the figure has melted back into the staff, from 0 to 1.
export function melt(tau: number) {
  return smooth(RELEASE_START, RELEASE_END, tau);
}

// Where the glimmer that runs the length of the staff is, from 0 (left edge)
// to 1 (right edge), or null when there is none: once as a phrase begins and
// once as it holds. It eases in and out so it never jumps on or off the glass.
export function sweep(tau: number) {
  if (tau < 2.4) return easeInOut(tau / 2.4);
  if (tau > 5.2 && tau < 7.4) return easeInOut((tau - 5.2) / 2.2);
  return null;
}

// The last moment anything in the figure is still forming, for timing marks after it.
export function settledAt(figure: Figure) {
  const last = figure.notes.reduce((latest, { at }) => Math.max(latest, at), figure.clef ? POUR_END : 0);
  return last + STEM_DELAY + GROW;
}

type Curve = [c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number];

function bezier(start: Point, curves: Curve[], segments = 26): Point[] {
  const points: Point[] = [start];
  let [x0, y0] = start;
  for (const [c1x, c1y, c2x, c2y, x, y] of curves) {
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      const u = 1 - t;
      points.push([
        u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      ]);
    }
    x0 = x;
    y0 = y;
  }
  return points;
}

// A clef as one swelling stroke, in staff spaces from the clef's origin on the
// middle line, plus the round blobs and dots engraved with it.
export interface ClefShape {
  points: Point[];
  // Full stroke width at each point, in staff spaces.
  widths: number[];
  blobs: { at: Point; radius: number; when: 'start' | 'end' | 'after' }[];
}

const swell = (thin: number, thick: number, peak = 0.5) => (t: number) => {
  const s = t < peak ? (t / peak) * 0.5 : 0.5 + ((t - peak) / (1 - peak)) * 0.5;
  return thin + (thick - thin) * Math.sin(Math.PI * s);
};

function shape(points: Point[], width: (t: number) => number, blobs: ClefShape['blobs']): ClefShape {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = lengths.at(-1) || 1;
  return { points, widths: lengths.map(length => width(length / total)), blobs };
}

export function clefShape(kind: 'treble' | 'bass'): ClefShape {
  if (kind === 'treble') {
    // Curls around the G line, rises into the loop above the staff, and drops to the tail.
    const scale = 1.12;
    const points = bezier([0.28, 1.02], [
      [-0.3, 1.0, -0.38, 0.2, 0.2, 0.12],
      [1.12, 0.08, 1.2, 1.78, 0.15, 1.88],
      [-1.05, 1.95, -1.35, 0.62, -0.62, -0.32],
      [0.02, -1.12, 0.88, -1.82, 0.82, -2.92],
      [0.76, -3.72, 0.2, -3.82, 0.04, -3.1],
      [-0.16, -2.4, 0.1, 0.5, 0.36, 2.92],
      [0.46, 3.72, -0.3, 4.02, -0.56, 3.46],
    ]).map(([x, y]): Point => [x * scale, y * scale]);
    const clamp = (t: number) => clamp01(t);
    const width = (t: number) => scale * 1.3 * (0.13 + 0.3 * Math.pow(Math.sin(Math.PI * clamp((t - 0.18) / 0.36)), 1.4)
      + 0.12 * Math.pow(Math.sin(Math.PI * clamp((t - 0.62) / 0.24)), 2));
    return shape(points, width, [{ at: [-0.42 * scale, 3.3 * scale], radius: 0.36 * scale, when: 'end' }]);
  }
  // Starts at the head on the F line, sweeps up and round, and tapers away below.
  const scale = 1.05;
  const points = bezier([0.12, -1.28], [
    [0.05, -2.3, 1.95, -2.55, 2.12, -1.15],
    [2.3, 0.45, 1.0, 1.95, -0.55, 2.8],
  ]).map(([x, y]): Point => [x * scale, y * scale]);
  const width = swell(0.14, 0.72, 0.42);
  return shape(points, t => width(t) * scale, [
    { at: [0.22 * scale, -1.0], radius: 0.46 * scale, when: 'start' },
    { at: [2.85 * scale, -1.5], radius: 0.24 * scale, when: 'after' },
    { at: [2.85 * scale, -0.5], radius: 0.24 * scale, when: 'after' },
  ]);
}
