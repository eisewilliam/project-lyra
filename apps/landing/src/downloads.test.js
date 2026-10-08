import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from './site-config.js';
test('desktop visitors receive the appropriate platform', () => {
  assert.equal(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }), 'macos');
  assert.equal(detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows');
  assert.equal(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
});
test('mobile and unsupported platforms do not receive desktop downloads', () => {
  assert.equal(detectPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }), null);
  assert.equal(detectPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18)' }), null);
  assert.equal(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }), null);
  assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)' }), null);
  assert.equal(detectPlatform({}), null);
});

