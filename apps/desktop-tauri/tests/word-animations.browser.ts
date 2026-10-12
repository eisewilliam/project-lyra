import { createWordAnimations } from '../src/utils/playback-sync';

// Run in the Vite preview:
// await (await import('/tests/word-animations.browser.ts')).checkWordAnimations()
export async function checkWordAnimations() {
  const word = document.createElement('span');
  word.textContent = 'Animation fixture';
  document.body.append(word);
  const baselineRef = { current: { ms: 1500, at: performance.now(), targetMs: 1500, targetAt: performance.now(), blendDur: 1 } };
  const animations = createWordAnimations([{ text: word.textContent, start_ms: 1000, end_ms: 2000 }],
    { current: [word] }, baselineRef);
  if (!animations) {
    word.remove();
    throw new Error('Webview lacks native custom-property animations');
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
  const progress = () => Number(getComputedStyle(word).getPropertyValue('--word-progress'));
  const seek = (ms: number, playing: boolean) => {
    const now = performance.now();
    baselineRef.current = { ms, at: now, targetMs: ms, targetAt: now, blendDur: 1 };
    animations.sync(playing);
  };
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    return label;
  };
  try {
    seek(1500, false);
    await settle();
    const results = [check(Math.abs(progress() - 0.5) < 0.001, 'Paused word holds exact progress')];
    seek(1500, true);
    await settle();
    results.push(check(progress() > 0.55 && progress() < 0.7, 'Native wipe advances between snapshots'));
    seek(1100, false);
    await settle();
    results.push(check(Math.abs(progress() - 0.1) < 0.001, 'Paused backward seek has no extra animation frame'));
    seek(2500, true);
    await settle();
    results.push(check(progress() === 1, 'Finished word remains fully highlighted'));
    seek(1200, true);
    await settle();
    results.push(check(progress() > 0.25 && progress() < 0.4, 'Finished animation resumes after a backward seek'));
    animations.stop();
    results.push(check(word.getAnimations().length === 0, 'Cleanup removes native animations'));
    return results;
  } finally {
    animations.stop();
    word.remove();
  }
}
