// Shared playback-sync primitives used by all three lyric surfaces (main,
// island, karaoke). These were previously copy-pasted into each view; keeping
// one definition means a sync/interpolation fix lands everywhere at once.
import type { LyricWord, PlaybackCaps } from '@/types/tauri-contracts';
import { setSurfaceOccluded, windowReady, type SurfaceLabel } from '@/utils/tauri-commands';

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
  if (autoHidden !== undefined) {
    autoHiddenRef.current = autoHidden;
    setSurfaceAutoHidden(autoHidden);
  }
  const visible = desiredRef.current && !autoHiddenRef.current;
  setVisible(visible);
  applySurfaceVisible(visible);
  return visible;
}

// A surface hidden by auto-hide (paused, or nothing playing) is waiting for
// playback to bring it back, so it still needs ticks and the host must keep
// polling the player. It never counts as occluded.
let surfaceAutoHidden = false;
let reportOcclusion: (() => void) | null = null;

function setSurfaceAutoHidden(hidden: boolean) {
  surfaceAutoHidden = hidden;
  reportOcclusion?.();
}

// Report page visibility (minimized, fully covered, other Space, locked
// screen) so the host stops ticking a surface nobody can see — and stops
// polling the player when every surface is hidden. Installed once per window.
function reportSurfaceOcclusion(label: SurfaceLabel) {
  let last: boolean | null = null;
  const report = () => {
    const occluded = document.hidden && !surfaceAutoHidden;
    if (occluded === last) return;
    last = occluded;
    setSurfaceOccluded(label, occluded).catch(() => {
      last = null;
    });
  };
  reportOcclusion = report;
  document.addEventListener('visibilitychange', report);
  if (document.hidden) report();
}

const WINDOW_READY_ATTEMPTS = 20;
const WINDOW_READY_RETRY_MS = 250;

// Surfaces call this once on mount and never again, so one failed call would
// leave a surface without playback for the whole session. Retry for a few
// seconds instead.
async function windowReadyWithRetry(label: SurfaceLabel): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await windowReady(label);
      return;
    } catch (err) {
      if (attempt >= WINDOW_READY_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, WINDOW_READY_RETRY_MS));
    }
  }
}

// Build a memoized `window_ready` invoker for a surface. The backend shows the
// native window per persisted visibility before the frontend issues further
// IPC — a hidden WKWebView queues `evaluateJavaScript`, so this must resolve
// before any other invoke()/listen() call. Resets on failure so a retry works.
export function makeWindowReady(label: SurfaceLabel): () => Promise<void> {
  let promise: Promise<void> | null = null;
  let occlusionInstalled = false;
  return () => {
    promise ??= windowReadyWithRetry(label)
      .then(() => {
        if (!occlusionInstalled) {
          occlusionInstalled = true;
          reportSurfaceOcclusion(label);
        }
      })
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

export type WordAnimations = {
  sync: (isPlaying: boolean) => void;
  stop: () => void;
};

/** A running word wipe is re-seeked only when it is off by more than this.
 * Seeking every word on every snapshot made lit words shimmer. */
const WORD_SEEK_TOLERANCE_MS = 30;

/** Where playback is now with any snapshot correction applied in full. The
 * frame loops blend into corrections; native wipes take them in one step,
 * and only when they are large enough to see. */
function targetPosition(b: PositionBaseline, now: number, playing: boolean): number {
  return playing ? b.targetMs + (now - b.targetAt) : b.ms;
}

/** Native word wipes, built once per line and reconciled with each snapshot.
 * Older webviews without registered custom properties use runWordColouring.
 *
 * The playback rate is never changed. Each animation's time is the song
 * position, tens of seconds in, so an engine that rebuilds a just-finished
 * animation from its old start time at a new rate moves it by song time ×
 * rate change: a lit word dropped back by ~150 ms on a 0.2% blend.
 */
export function createWordAnimations(
  words: LyricWord[],
  wordRefs: { current: (HTMLSpanElement | null)[] },
  baselineRef: { current: PositionBaseline },
): WordAnimations | null {
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function'
    || words.some((_, i) => typeof wordRefs.current[i]?.animate !== 'function')) return null;

  const spans = words.map((word) => {
    const duration = Math.max(1, word.end_ms - word.start_ms);
    return { start: word.start_ms, end: word.start_ms + duration, duration };
  });
  const animations = spans.map((span, i) => wordRefs.current[i]!.animate(
    [{ '--word-progress': '0' }, { '--word-progress': '1' }],
    { delay: span.start, duration: span.duration, fill: 'both' },
  ));
  for (const animation of animations) animation.pause();

  let syncs = 0;
  const sync = (isPlaying: boolean) => {
    const token = ++syncs;
    const position = targetPosition(baselineRef.current, performance.now(), isPlaying);
    animations.forEach((animation, i) => {
      if (!isPlaying) {
        // A pause lands on the next animation frame and holds the time
        // reached by then; seek again once it has, so the word holds exactly
        // where playback stopped.
        animation.pause();
        animation.currentTime = position;
        animation.ready
          .then(() => {
            if (token === syncs && animation.playState === 'paused') animation.currentTime = position;
          })
          .catch(() => undefined);
        return;
      }
      if (animation.playState === 'paused') {
        // Play before seeking: play() rewinds an animation whose time is
        // past its end, which would dim a word already sung.
        animation.play();
        animation.currentTime = position;
        return;
      }
      // Running or finished: seek only on a correction that would show.
      // Compare inside the word's own window; a finished word holds its end
      // time while playback moves on.
      const span = spans[i]!;
      const clamp = (t: number) => Math.min(span.end, Math.max(span.start, t));
      const current = Number(animation.currentTime ?? position);
      if (Math.abs(clamp(position) - clamp(current)) > WORD_SEEK_TOLERANCE_MS) {
        animation.currentTime = position;
      }
    });
  };
  return {
    sync,
    stop: () => {
      syncs++;
      for (const animation of animations) animation.cancel();
    },
  };
}
