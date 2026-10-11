// Shared playback-sync primitives used by all three lyric surfaces (main,
// island, karaoke). These were previously copy-pasted into each view; keeping
// one definition means a sync/interpolation fix lands everywhere at once.
import type { LyricWord, PlaybackCaps } from '@/types/tauri-contracts';
import { windowReady, type SurfaceLabel } from '@/utils/tauri-commands';

export const BLEND_MS = 500;

/** Controls before the first snapshot arrives or when no player is followed. */
export const NO_PLAYBACK_CAPS: PlaybackCaps = {
  play_pause: false,
  next: false,
  previous: false,
  seek: false,
  raise: false,
};

export function sameCaps(a: PlaybackCaps, b: PlaybackCaps): boolean {
  return a.play_pause === b.play_pause
    && a.next === b.next
    && a.previous === b.previous
    && a.seek === b.seek
    && a.raise === b.raise;
}

export type { LyricWord };

export type PositionBaseline = {
  ms: number;
  at: number;
  targetMs: number;
  targetAt: number;
  blendDur: number;
};

// Interpolate playback position with continuous blending between the previous
// trajectory and a new target. Avoids discrete per-poll jumps that would
// otherwise show up as visible jitter in the karaoke wipe. When paused,
// freezes at the baseline value (which was snapped to the paused position).
export function interpolatePosition(b: PositionBaseline, now: number, playing: boolean): number {
  if (!playing) return b.ms;
  const currentTraj = b.ms + (now - b.at);
  const targetTraj = b.targetMs + (now - b.targetAt);
  const elapsed = now - b.at;
  if (elapsed >= b.blendDur) return targetTraj;
  const t = elapsed / Math.max(1, b.blendDur);
  return currentTraj * (1 - t) + targetTraj * t;
}

export function wordsKey(words: LyricWord[] | null | undefined): string {
  return (words ?? [])
    .map((word) => `${word.start_ms}:${word.end_ms}:${word.text}`)
    .join('|');
}

export function applySurfaceVisible(visible: boolean) {
  document.documentElement.dataset.surfaceVisible = String(visible);
}

// Reconcile a surface's desired visibility (user preference) with auto-hide
// (e.g. hide-when-paused). Mutates the supplied refs and pushes the resolved
// value to React + the DOM dataset. Returns the resolved visibility.
export function syncSurfaceVisible(
  desiredRef: { current: boolean },
  autoHiddenRef: { current: boolean },
  setVisible: (visible: boolean) => void,
  desired?: boolean,
  autoHidden?: boolean,
): boolean {
  if (desired !== undefined) desiredRef.current = desired;
  if (autoHidden !== undefined) autoHiddenRef.current = autoHidden;
  const visible = desiredRef.current && !autoHiddenRef.current;
  setVisible(visible);
  applySurfaceVisible(visible);
  return visible;
}

// Build a memoized `window_ready` invoker for a surface. The backend shows the
// native window per persisted visibility before the frontend issues further
// IPC — a hidden WKWebView queues `evaluateJavaScript`, so this must resolve
// before any other invoke()/listen() call. Resets on failure so a retry works.
export function makeWindowReady(label: string): () => Promise<void> {
  let promise: Promise<void> | null = null;
  return () => {
    promise ??= windowReady(label as SurfaceLabel)
      .then(() => undefined)
      .catch((err) => {
        promise = null;
        throw err;
      });
    return promise;
  };
}

// Per-frame word-karaoke colouring loop shared by every surface. Compares the
// interpolated position against each word's [start,end] and toggles the
// upcoming/singing/passed class + the `--word-progress` custom property.
// JS-side caches (lastCls/lastProgQ) avoid forced style-recalc from reading
// `className`/attributes back out of the DOM each frame.
export function runWordColouring(
  words: LyricWord[],
  wordRefs: { current: (HTMLSpanElement | null)[] },
  baselineRef: { current: PositionBaseline },
  isPlaying: boolean,
): () => void {
  let raf = 0;
  const lastCls: string[] = new Array(words.length).fill('');
  const lastProgQ: number[] = new Array(words.length).fill(-1);
  const tick = () => {
    const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const el = wordRefs.current[i];
      if (!w || !el) continue;
      let cls: string;
      let progress: number;
      if (pos >= w.end_ms) {
        cls = 'lyric-word passed';
        progress = 1;
      } else if (pos >= w.start_ms) {
        cls = 'lyric-word singing';
        progress = Math.max(0, Math.min(1, (pos - w.start_ms) / Math.max(1, w.end_ms - w.start_ms)));
      } else {
        cls = 'lyric-word upcoming';
        progress = 0;
      }
      if (cls !== lastCls[i]) {
        lastCls[i] = cls;
        el.className = cls;
      }
      const progQ = Math.trunc(progress * 1000);
      if (progQ !== lastProgQ[i]) {
        lastProgQ[i] = progQ;
        el.style.setProperty('--word-progress', (progQ / 1000).toString());
      }
    }
    if (isPlaying) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
