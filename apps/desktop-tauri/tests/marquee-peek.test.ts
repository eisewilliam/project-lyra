import { describe, expect, test } from 'bun:test';
import {
  PEEK_STEP_PX,
  computeNextPeekIndex,
  consumePeekWheelStep,
  formatPeekDelta,
  normalizeWheelDeltaY,
} from '../src/views/marquee/peek-math';

describe('marquee vertical scroll peek math', () => {
  test('normalizes wheel deltas across pixel, line, and page modes', () => {
    expect(normalizeWheelDeltaY(36, 0)).toBe(36);
    expect(normalizeWheelDeltaY(3, 1)).toBe(84);
    expect(normalizeWheelDeltaY(-1, 2)).toBe(-120);
  });

  test('accumulates subtle trackpad deltas until crossing step threshold', () => {
    const step1 = consumePeekWheelStep(0, 14);
    expect(step1).toEqual({ step: 0, nextAccumulated: 14 });

    const step2 = consumePeekWheelStep(step1.nextAccumulated, 14);
    expect(step2).toEqual({ step: 0, nextAccumulated: 28 });

    const step3 = consumePeekWheelStep(step2.nextAccumulated, 12);
    expect(step3).toEqual({ step: 1, nextAccumulated: 4 });
  });

  test('consumes discrete mouse wheel notches as a single line step', () => {
    expect(consumePeekWheelStep(0, 120)).toEqual({ step: 1, nextAccumulated: 0 });
    expect(consumePeekWheelStep(0, -100)).toEqual({ step: -1, nextAccumulated: 0 });
    expect(consumePeekWheelStep(10, 84)).toEqual({ step: 1, nextAccumulated: 0 });
    expect(PEEK_STEP_PX).toBe(36);
  });

  test('resets prior remainder when scroll direction reverses', () => {
    const rev = consumePeekWheelStep(25, -18);
    expect(rev).toEqual({ step: 0, nextAccumulated: -18 });

    const cross = consumePeekWheelStep(rev.nextAccumulated, -20);
    expect(cross).toEqual({ step: -1, nextAccumulated: -2 });
  });

  test('steps from live index, clamps at bounds, and returns to live when crossing back', () => {
    expect(
      computeNextPeekIndex({ currentPeek: null, liveIndex: 5, totalLines: 10, step: 1 }),
    ).toEqual({ kind: 'peek', index: 6, direction: 1 });

    expect(
      computeNextPeekIndex({ currentPeek: 6, liveIndex: 5, totalLines: 10, step: -1 }),
    ).toEqual({ kind: 'live', direction: -1 });

    expect(
      computeNextPeekIndex({ currentPeek: 4, liveIndex: 5, totalLines: 10, step: 1 }),
    ).toEqual({ kind: 'live', direction: 1 });

    expect(
      computeNextPeekIndex({ currentPeek: 0, liveIndex: 5, totalLines: 10, step: -1 }),
    ).toEqual({ kind: 'boundary', direction: -1 });

    expect(
      computeNextPeekIndex({ currentPeek: 9, liveIndex: 5, totalLines: 10, step: 1 }),
    ).toEqual({ kind: 'boundary', direction: 1 });
  });

  test('handles pre-roll when no line is live yet', () => {
    expect(
      computeNextPeekIndex({ currentPeek: null, liveIndex: null, totalLines: 8, step: 1 }),
    ).toEqual({ kind: 'peek', index: 0, direction: 1 });

    expect(
      computeNextPeekIndex({ currentPeek: null, liveIndex: null, totalLines: 8, step: -1 }),
    ).toEqual({ kind: 'boundary', direction: -1 });

    expect(
      computeNextPeekIndex({ currentPeek: null, liveIndex: 0, totalLines: 0, step: 1 }),
    ).toEqual({ kind: 'noop' });
  });

  test('formats directional offset badges relative to live line', () => {
    expect(formatPeekDelta(7, 5, 20)).toBe('↓ 2');
    expect(formatPeekDelta(2, 5, 20)).toBe('↑ 3');
    expect(formatPeekDelta(0, null, 20)).toBe('1/20');
  });
});
