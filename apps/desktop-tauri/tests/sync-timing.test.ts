import { describe, expect, test } from 'bun:test';
import {
  describeOffset,
  formatOffsetShort,
  isTapTargetStale,
  offsetForTap,
  pickTapTarget,
} from '../src/views/app/sync-timing';

const lines = [
  { start_ms: 1000, text: 'First' },
  { start_ms: 4000, text: '' },
  { start_ms: 6000, text: 'Second' },
  { start_ms: 9000, text: 'Third' },
];

describe('lyric sync timing', () => {
  test('describes offsets in seconds, in the direction the lyrics move', () => {
    expect(describeOffset(0)).toBe('Original timing');
    expect(describeOffset(300)).toBe('0.3 s later');
    expect(describeOffset(-1250)).toBe('1.25 s earlier');
    expect(describeOffset(2000)).toBe('2.0 s later');
    expect(formatOffsetShort(-300)).toBe('−0.3 s');
    expect(formatOffsetShort(470)).toBe('+0.47 s');
  });

  test('tap target is the next line with words, far enough ahead to read', () => {
    expect(pickTapTarget(lines, -500, 0)).toBe(0);
    // Too close to read in time.
    expect(pickTapTarget(lines, 0, 0)).toBe(2);
    // The empty instrumental line is skipped.
    expect(pickTapTarget(lines, 2000, 0)).toBe(2);
    // 6000 is under 1.2 s away at 5000, so the line after it.
    expect(pickTapTarget(lines, 5000, 0)).toBe(3);
    // Lyrics shown 2 s later push every line's expected start back.
    expect(pickTapTarget(lines, 5000, 2000)).toBe(2);
    expect(pickTapTarget(lines, 2000, 0, { after: 2 })).toBe(3);
    expect(pickTapTarget(lines, 9000, 0)).toBeNull();
  });

  test('a tap moves the line to the moment of the tap', () => {
    const line = { start_ms: 6000, text: 'Second' };
    expect(offsetForTap(line, 6470)).toBe(470);
    expect(offsetForTap(line, 5204)).toBe(-800);
    expect(offsetForTap(line, 60_000)).toBe(30_000);
  });

  test('a target well past its expected start is stale', () => {
    const line = { start_ms: 6000, text: 'Second' };
    expect(isTapTargetStale(line, 11_000, 0)).toBe(false);
    expect(isTapTargetStale(line, 12_500, 0)).toBe(true);
    expect(isTapTargetStale(line, 12_500, 1000)).toBe(false);
  });
});
