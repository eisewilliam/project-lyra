// At 640 × 440 in the Vite preview, with the demo track paused at 12.6 seconds:
// await (await import('/tests/adjust-sync-layout.browser.ts')).checkAdjustSyncLayout()
export async function checkAdjustSyncLayout() {
  const get = (selector: string) => document.querySelector<HTMLElement>(selector);
  const opener = get('button[aria-label="Track actions"]');
  const pane = get('.lyrics-pane');
  const activeLine = get('.lyric-line.is-active');
  if (!opener || !pane || !activeLine) throw new Error('Expected the main window with an active lyric');

  const center = (box: DOMRect) => box.top + box.height / 2;
  const aligned = (element: HTMLElement) =>
    Math.abs(center(activeLine.getBoundingClientRect()) - center(element.getBoundingClientRect())) < 2;
  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = performance.now() + 2500;
    while (!condition()) {
      if (performance.now() >= deadline) throw new Error(message);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };

  await waitFor(() => aligned(pane), 'Expected the current lyric at the center before opening Adjust Sync');
  Object.assign(window, { __lyraMockMenuChoice: 'sync' });
  opener.click();
  try {
    await waitFor(() => {
      const rail = get('.sync-nudge');
      return rail !== null && aligned(rail);
    }, 'Opening Adjust Sync moved the current lyric away from the controls');

    const lineBox = activeLine.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    if (lineBox.top < paneBox.top || lineBox.bottom > paneBox.bottom) {
      throw new Error('Adjust Sync clipped the current lyric');
    }

    const earlier = get('button[aria-label="Earlier"]');
    const later = get('button[aria-label="Later"]');
    if (!earlier || !later) throw new Error('Expected both Adjust Sync buttons');
    const earlierBox = earlier.getBoundingClientRect();
    const laterBox = later.getBoundingClientRect();
    if (earlierBox.x !== laterBox.x || earlierBox.bottom >= laterBox.top || earlierBox.left <= lineBox.right) {
      throw new Error('Expected Earlier above Later beside the lyric');
    }
    later.focus({ preventScroll: true });
    for (const key of ['Enter', ' ']) {
      if (!later.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))) {
        throw new Error('Lyrics navigation intercepted keyboard activation of Later');
      }
    }
  } finally {
    get('.sync-done-btn')?.click();
  }
  await waitFor(() => !get('.sync-nudge') && aligned(pane), 'Closing Adjust Sync left the current lyric off center');
}
