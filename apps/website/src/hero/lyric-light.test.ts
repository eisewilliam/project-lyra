import { describe, expect, test } from 'vitest';
import { LyricLight } from './lyric-light.ts';
import { FORM, PHRASE_LENGTH, POUR_START, RELEASE_END, figures } from './phrases.ts';

// Exercise the score's geometry without a browser or GPU. The rods are at rest;
// rendering, refraction and animation pacing are checked in the browser.
function score(strings: object = { at: () => 0 }) {
  const engine = Object.create(LyricLight.prototype) as LyricLight;
  engine.staff = {
    width: 1440, height: 900, space: 36, text: 36, radius: 5.4, head: 20.88,
    cy: 450, left: -72, right: 1512, columnLeft: 700, columnRight: 1380,
  };
  Object.defineProperty(engine, 'strings', { value: strings });
  engine.introElapsed = -1;
  return engine;
}

describe('glass score transitions', () => {
  test.each(figures)('$name leaves a clean staff once its melt finishes', figure => {
    const engine = score();
    for (const tau of [RELEASE_END, PHRASE_LENGTH - 0.01]) {
      const frame = engine.shapes(figure, engine.staff!, tau, tau);
      expect(frame.shapes).toEqual([]);
      expect(frame.flashes).toEqual([]);
      expect(frame.clef).toBeNull();
    }
  });

  test('the beam thins during the melt instead of disappearing while stems remain', () => {
    const engine = score();
    const figure = figures[2]!;
    const frame = (tau: number) => engine.shapes(figure, engine.staff!, tau, 20 + tau).shapes;
    const beam = (tau: number) => frame(tau).find(shape => shape.kind === 0 && shape.a[0] !== shape.b[0]);
    const held = beam(6.8)!;
    const melting = beam(8.2);
    expect(melting).toBeDefined();
    expect(melting!.thickness).toBeGreaterThan(0);
    expect(melting!.thickness).toBeLessThan(held.thickness);
  });

  test('notes enter without a zero-size glass join as they start to form', () => {
    const engine = score();
    const figure = figures[2]!;
    const tau = figure.notes[0]!.at - FORM;
    expect(engine.shapes(figure, engine.staff!, tau, tau).shapes).toEqual([]);
  });

  test('a clef stays hidden until its pour begins', () => {
    const engine = score();
    expect(engine.shapes(figures[0]!, engine.staff!, POUR_START, POUR_START).clef).toBeNull();
  });

  test('a tap plucks the nearest rod only when it lands on the staff', () => {
    const plucks: number[] = [];
    const engine = score({ at: () => 0, pluck: (k: number) => plucks.push(k) });
    engine.time = 0;
    engine.playing = true;
    const { cy, space } = engine.staff!;
    const midLine = cy + engine.wave(1000, 0);
    expect(engine.tap(1000, midLine + space * 0.3)).toBe(true);
    expect(plucks).toEqual([2]);
    expect(engine.tap(1000, midLine + space * 4)).toBe(false);
    engine.playing = false;
    expect(engine.tap(1000, midLine)).toBe(false);
    expect(plucks).toEqual([2]);
  });

  test('while the staff is strung its rods ripple without crossing, then settle flat', () => {
    const engine = score();
    const { space } = engine.staff!;
    let moved = 0;
    for (let elapsed = 0; elapsed <= 3; elapsed += 0.05) {
      engine.introElapsed = elapsed;
      for (let x = -72; x <= 1512; x += 24) {
        moved = Math.max(moved, Math.abs(engine.ripple(2, x)));
        for (let k = 0; k < 4; k += 1) {
          expect(engine.rodY(k + 1, x, 0) - engine.rodY(k, x, 0)).toBeGreaterThan(space * 0.5);
        }
      }
    }
    expect(moved).toBeGreaterThan(space * 0.5);
    engine.introElapsed = 4;
    for (let k = 0; k < 5; k += 1) {
      expect(engine.drawn(k)).toBe(1);
      for (let x = -72; x <= 1512; x += 24) expect(engine.ripple(k, x)).toBe(0);
    }
  });

  test('the rods cannot be plucked until the staff is strung', () => {
    const plucks: number[] = [];
    const engine = score({ at: () => 0, pluck: (k: number) => plucks.push(k) });
    engine.time = 0;
    engine.playing = true;
    engine.introElapsed = 0.5;
    const midLine = engine.rodY(2, 1000, 0);
    expect(engine.tap(1000, midLine)).toBe(false);
    engine.introElapsed = 4;
    expect(engine.tap(1000, engine.rodY(2, 1000, 0))).toBe(true);
    expect(plucks).toEqual([2]);
  });

  test('sustained slow frames keep the quality floor instead of dropping another tier', () => {
    const engine = score();
    engine.quality = 1;
    engine.slowFrames = 0;
    engine.onQualityChange = null;
    for (let i = 0; i < 500; i += 1) engine.adapt(0.04);
    expect(engine.quality).toBe(0.6);
  });

  test('alternating missed frames lower quality instead of cancelling out the slow-frame count', () => {
    const engine = score();
    engine.quality = 1;
    engine.slowFrames = 0;
    engine.onQualityChange = null;
    for (let i = 0; i < 100; i += 1) {
      engine.adapt(1 / 30);
      engine.adapt(1 / 60);
    }
    expect(engine.quality).toBe(0.8);
  });
});
