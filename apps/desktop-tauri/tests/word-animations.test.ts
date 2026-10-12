import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createWordAnimations, type WordAnimations } from '../src/utils/playback-sync';

const previousCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
let controller: WordAnimations | null = null;

afterEach(() => {
  controller?.stop();
  controller = null;
  mock.restore();
  if (previousCss) Object.defineProperty(globalThis, 'CSS', previousCss);
  else Reflect.deleteProperty(globalThis, 'CSS');
});

function fixture() {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { registerProperty() {} } });
  spyOn(performance, 'now').mockReturnValue(100);
  const animations = Array.from({ length: 2 }, () => ({
    currentTime: 0,
    playbackRate: 1,
    playState: 'paused',
    ready: Promise.resolve(),
    play: mock(function (this: { playState: string }) { this.playState = 'running'; }),
    pause: mock(function (this: { playState: string }) { this.playState = 'paused'; }),
    cancel: mock(function (this: { playState: string }) { this.playState = 'idle'; }),
  }));
  const elements = animations.map((animation) => ({
    animate: mock(() => animation as unknown as Animation),
  }));
  const baselineRef = { current: { ms: 1200, at: 100, targetMs: 1200, targetAt: 100, blendDur: 1 } };
  const words = [{ text: 'one', start_ms: 1000, end_ms: 1500 }, { text: 'two', start_ms: 1600, end_ms: 2000 }];
  controller = createWordAnimations(words, {
    current: elements as unknown as HTMLSpanElement[],
  }, baselineRef);
  return { animations, baselineRef, elements, words, controller: controller! };
}

describe('native word animations', () => {
  test('builds each word once and resynchronizes pause, seek and resume', () => {
    const { animations, baselineRef, elements, controller } = fixture();
    controller.sync(true);
    expect(animations.map((animation) => animation.currentTime)).toEqual([1200, 1200]);
    expect(animations.every((animation) => animation.playState === 'running')).toBe(true);
    controller.sync(false);
    expect(animations.every((animation) => animation.playState === 'paused')).toBe(true);
    baselineRef.current = { ms: 1700, at: 100, targetMs: 1700, targetAt: 100, blendDur: 1 };
    controller.sync(false);
    expect(animations.map((animation) => animation.currentTime)).toEqual([1700, 1700]);
    controller.sync(true);
    baselineRef.current = { ms: 1100, at: 100, targetMs: 1100, targetAt: 100, blendDur: 1 };
    controller.sync(true);
    expect(animations.map((animation) => animation.currentTime)).toEqual([1100, 1100]);
    expect(animations.every((animation) => animation.playbackRate === 1)).toBe(true);
    expect(elements.every((element) => element.animate.mock.calls.length === 1)).toBe(true);
    expect(elements[1]!.animate.mock.calls[0]).toEqual([
      [{ '--word-progress': '0' }, { '--word-progress': '1' }],
      { delay: 1600, duration: 400, fill: 'both' },
    ]);
  });

  test('takes a snapshot correction in one step without changing the rate', () => {
    const { animations, baselineRef, controller } = fixture();
    baselineRef.current = { ms: 1000, at: 0, targetMs: 1100, targetAt: 0, blendDur: 500 };
    controller.sync(true);
    expect(animations.map((animation) => animation.currentTime)).toEqual([1200, 1200]);
    expect(animations.every((animation) => animation.playbackRate === 1)).toBe(true);
  });

  test('leaves running and finished words alone unless a correction would show', () => {
    const { animations, baselineRef, controller } = fixture();
    controller.sync(true);
    // Native playback moved the first word on; a 15 ms correction stays put.
    animations[0]!.currentTime = 1210;
    baselineRef.current = { ms: 1225, at: 100, targetMs: 1225, targetAt: 100, blendDur: 1 };
    controller.sync(true);
    expect(animations[0]!.currentTime).toBe(1210);
    // Later both words have finished and hold their ends while the song
    // continues: nothing to seek.
    animations[0]!.currentTime = 1500;
    animations[1]!.currentTime = 2000;
    baselineRef.current = { ms: 2400, at: 100, targetMs: 2400, targetAt: 100, blendDur: 1 };
    controller.sync(true);
    expect(animations.map((animation) => animation.currentTime)).toEqual([1500, 2000]);
  });

  test('cancels every animation on line replacement or hiding', () => {
    const { animations, controller } = fixture();
    controller.sync(true);
    controller.stop();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  test('falls back when the webview cannot animate registered properties', () => {
    Reflect.deleteProperty(globalThis, 'CSS');
    expect(createWordAnimations([], { current: [] }, {
      current: { ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 },
    })).toBeNull();
  });
});
