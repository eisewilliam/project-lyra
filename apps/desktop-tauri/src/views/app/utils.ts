import type { TrackRef } from '@/types/tauri-contracts';

export const noop = (...args: unknown[]) => { if (args) return; };

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
  if (index < activeLine - 1) return 'is-passed-2';
  if (index === activeLine + 1) return 'is-future-1';
  if (index > activeLine + 1) return 'is-future-2';
  return '';
}
