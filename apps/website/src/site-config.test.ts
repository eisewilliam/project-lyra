import { describe, expect, test } from 'vitest';
import { detectPlatform, isPlatform, playersAndOthers, playersOrOthers } from './site-config.ts';

describe('detectPlatform', () => {
  test('desktop visitors receive the appropriate platform', () => {
    expect(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })).toBe('macos');
    expect(detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('windows');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
  });

  test('mobile and unsupported platforms do not receive desktop downloads', () => {
    expect(detectPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' })).toBeNull();
    expect(detectPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18)' })).toBeNull();
    expect(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 })).toBeNull();
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)' })).toBeNull();
    expect(detectPlatform({})).toBeNull();
  });
});

test('only known platforms pass the ?platform= check', () => {
  expect(isPlatform('linux')).toBe(true);
  expect(isPlatform('android')).toBe(false);
  expect(isPlatform(undefined)).toBe(false);
});

test('player lists read as one British-style list', () => {
  expect(playersAndOthers).toBe('Spotify, Apple Music, YouTube Music and most players that show up in your computer’s media controls');
  expect(playersOrOthers).toBe('Spotify, Apple Music, YouTube Music or another player that shows up in your computer’s media controls');
});
