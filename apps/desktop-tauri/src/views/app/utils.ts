import type { LyricsOrigin, TrackRef } from '@/types/tauri-contracts';

export const noop = (...args: unknown[]) => { if (args) return; };

/** Human-readable summary of custom or user-selected lyrics origin. */
export function describeLyricsOrigin(origin: LyricsOrigin): string | undefined {
  if (origin.kind === 'timed') return 'Showing the lyrics you timed';
  if (origin.kind === 'imported') {
    return origin.name ? `Showing lyrics from “${origin.name}”` : 'Showing lyrics from your file';
  }
  if (origin.kind === 'picked') return 'Showing lyrics you chose';
  return undefined;
}

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function sameTrack(a: TrackRef | null, b: TrackRef | null) {
  return a?.uri === b?.uri
    && a?.title === b?.title
    && a?.artist === b?.artist
    && a?.album === b?.album
    && a?.duration_ms === b?.duration_ms
    && a?.artwork_url === b?.artwork_url;
}

export function getLyricProximityClass(index: number, activeLine: number | null) {
  if (activeLine === null) return 'is-future-2';
  if (index === activeLine) return 'is-active';
  if (index === activeLine - 1) return 'is-passed-1';
  if (index === activeLine - 2) return 'is-passed-2';
  if (index < activeLine - 1) return 'is-passed-2';
  if (index === activeLine + 1) return 'is-future-1';
  if (index === activeLine + 2) return 'is-future-2';
  if (index > activeLine + 1) return 'is-future-2';
  return '';
}

const seekPulseTimers = new WeakMap<HTMLElement, number>();

export function pulseProgressTrack(trackEl: HTMLElement | null) {
  if (!trackEl) return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const existing = seekPulseTimers.get(trackEl);
  if (existing !== undefined) globalThis.clearTimeout(existing);
  trackEl.classList.remove('is-seek-pulse');
  requestAnimationFrame(() => {
    trackEl.classList.add('is-seek-pulse');
  });
  const timer = globalThis.setTimeout(() => {
    trackEl.classList.remove('is-seek-pulse');
    seekPulseTimers.delete(trackEl);
  }, 320);
  seekPulseTimers.set(trackEl, timer);
}
