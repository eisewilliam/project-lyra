import { expect, test } from 'bun:test';
import { formatMakerError, lyricLines, nextStamp, tapPosition } from '../src/views/app/lyric-maker';

test('timing skips blank stanza separators and preserves repeated lyrics', () => {
  expect(lyricLines(' One \r\n\r\n[Chorus]\rOne')).toEqual(['One', '[Chorus]', 'One']);
});

test('each tap needs a later LRC centisecond inside the recording', () => {
  expect(nextStamp(0, undefined, 1000)).toBe(0);
  expect(nextStamp(8, 0, 1000)).toBeNull();
  expect(nextStamp(999.99, 0, 1000)).toBe(990);
  expect(nextStamp(1010, 0, 1000)).toBeNull();
  expect(nextStamp(NaN, undefined, 0)).toBeNull();
});

test('taps use the observed player target and playback rate, including delivery delay', () => {
  const baseline = { ms: 900, at: 10, targetMs: 1020, targetAt: 10, blendDur: 100 };
  expect(tapPosition(baseline, { at: 10, rate: 2, ageMs: 20 }, 60)).toBe(1140);
  expect(tapPosition(baseline, { at: 0, rate: 2, ageMs: 20 }, 60)).toBe(1120);
});

test('maps raw maker and publish errors to plain user-facing copy', () => {
  expect(formatMakerError('LRCLIB responded with HTTP 429')).toBe('The lyric server is busy. Try again in a moment.');
  expect(formatMakerError(new Error('Could not save timed lyrics'))).toBe("Couldn't save synced lyrics.");
  expect(formatMakerError('Playing track changed before publish')).toBe('The playing track changed.');
  expect(formatMakerError('')).toBe('Something went wrong. Try again.');
});
