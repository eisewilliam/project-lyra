import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GlidingLine } from '../src/components/gliding-line';

// Run in the Vite preview:
// await (await import('/tests/gliding-line.browser.ts')).checkGlidingLine()
export async function checkGlidingLine() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:180px;background:#222';
  document.body.append(host);
  const root = createRoot(host);
  const now = performance.now();
  const baselineRef = { current: { ms: 4000, at: now, targetMs: 4000, targetAt: now, blendDur: 1 } };
  const words = [{ text: 'line', start_ms: 0, end_ms: 10000 }];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
  const render = (text: string, key: string, playing = false, running = true) => root.render(
    createElement(GlidingLine, {
      className: 'test-glide', contentClassName: 'test-glide-content', contentKey: key,
      syncProgress: 0.4, clock: { words, baselineRef, isPlaying: playing, running },
      children: createElement('span', { style: { whiteSpace: 'nowrap', fontSize: '20px' } }, text),
    }),
  );
  const transform = () => host.querySelector<HTMLElement>('.test-glide-content')?.style.transform ?? '';
  const longLine = 'A long lyric line that must scroll across the viewport';
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    return label;
  };
  try {
    render(longLine, 'long');
    await settle();
    const initial = transform();
    const results = [check(initial.startsWith('translateX(-'), 'First draw moves an overflowing line')];
    render('Short', 'short');
    await settle();
    results.push(check(transform() === '', 'Short replacement clears the old transform'));
    render(longLine, 'playing', true);
    await settle();
    const moving = transform();
    await settle();
    results.push(check(transform() !== moving, 'Glide advances between playback snapshots'));
    render(longLine, 'playing', true, false);
    await settle();
    const hidden = transform();
    await settle();
    results.push(check(transform() === hidden, 'Hidden surface stops animation work'));
    baselineRef.current = { ms: 0, at: now, targetMs: 0, targetAt: now, blendDur: 1 };
    render(longLine, 'seek', false);
    await settle();
    results.push(check(transform() === 'translateX(0px)', 'Paused backward seek resets the glide'));
    return results;
  } finally {
    root.unmount();
    host.remove();
  }
}
