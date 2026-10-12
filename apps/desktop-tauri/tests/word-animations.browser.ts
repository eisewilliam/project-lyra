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

    // A line shown mid-way plays straight after its build, while the build's
    // pause is still pending: words already sung must stay lit.
    const now = performance.now();
    baselineRef.current = { ms: 2500, at: now, targetMs: 2500, targetAt: now, blendDur: 1 };
    const late = createWordAnimations([{ text: word.textContent, start_ms: 1000, end_ms: 2000 }],
      { current: [word] }, baselineRef);
    late?.sync(true);
    await settle();
    results.push(check(progress() === 1, 'Sung words stay lit when a line starts mid-way'));
    late?.stop();

    // The reported flicker: a word finishes on its own while playing, then
    // snapshots keep blending small corrections. Once lit it must stay lit.
    const lit = document.createElement('span');
    lit.textContent = 'lit';
    document.body.append(lit);
    const startedAt = performance.now();
    const songNow = () => 76_900 + (performance.now() - startedAt);
    const songAt = (drift: number) => {
      const at = performance.now();
      const ms = songNow();
      return { ms, at, targetMs: ms + drift, targetAt: at, blendDur: 500 };
    };
    const clock = { current: songAt(0) };
    const lineAnimations = createWordAnimations([{ text: 'lit', start_ms: 76_500, end_ms: 77_010 }],
      { current: [lit] }, clock);
    lineAnimations?.sync(true);
    let litSeen = false;
    let lowestAfterLit = 1;
    await new Promise<void>((resolve) => {
      const frame = () => {
        const p = Number(getComputedStyle(lit).getPropertyValue('--word-progress'));
        if (p >= 0.999) litSeen = true;
        else if (litSeen) lowestAfterLit = Math.min(lowestAfterLit, p);
        if (performance.now() - startedAt < 900) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
      for (let i = 1; i <= 14; i++) {
        setTimeout(() => {
          clock.current = songAt(i % 2 ? 15 : -15);
          lineAnimations?.sync(true);
        }, i * 60);
      }
    });
    lineAnimations?.stop();
    lit.remove();
    results.push(check(litSeen && lowestAfterLit === 1,
      `A word stays lit through corrected snapshots once sung (lowest ${lowestAfterLit})`));
    return results;
  } finally {
    animations.stop();
    word.remove();
  }
}
