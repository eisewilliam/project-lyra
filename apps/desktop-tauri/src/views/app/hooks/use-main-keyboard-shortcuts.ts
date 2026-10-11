import { useEffect, useRef, type RefObject } from 'react';
import type { PlaybackCaps, TrackRef } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import { playbackPlayPause, playbackSeekMs } from '@/utils/tauri-commands';
import type { ShortcutFeedback } from './use-shortcut-hud';
import type { SkipDirection } from './use-track-skip';
import { noop } from '../utils';

const SEEK_STEP_MS = 5000;

// On macOS ⌘←/⌘→ are key equivalents of the native Playback menu, which
// handles them in every Lyra window. Elsewhere there is no menu bar.
const handlesTrackSkip = detectHostOs() !== 'macos';

// Keys typed into a control keep their native meaning (Space presses a
// focused button, arrows move a focused slider or the lyric list).
function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element
    && target.closest('button, a, input, select, textarea, [role="slider"], [contenteditable], .lyrics-pane') !== null;
}

/**
 * Media-player keys for the main window: Space plays/pauses, ←/→ seek 5 s,
 * and Ctrl+←/→ skip tracks on Windows/Linux. Each key follows the same
 * `caps` gate as its on-screen control.
 */
export function useMainKeyboardShortcuts({
  track,
  caps,
  isPlaying,
  togglePlaying,
  baselineRef,
  setPositionMs,
  onSkip,
  onFeedback,
}: {
  track: TrackRef | null;
  caps: PlaybackCaps;
  isPlaying: boolean;
  togglePlaying: () => void;
  baselineRef: RefObject<PositionBaseline>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  onSkip: (direction: SkipDirection) => void;
  /** Confirms a shortcut on screen, since nothing was clicked. */
  onFeedback: (kind: ShortcutFeedback) => void;
}) {
  const latestRef = useRef({ track, caps, isPlaying, togglePlaying, onSkip, onFeedback });
  useEffect(() => {
    latestRef.current = { track, caps, isPlaying, togglePlaying, onSkip, onFeedback };
  }, [track, caps, isPlaying, togglePlaying, onSkip, onFeedback]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const {
        track: current,
        caps: allowed,
        isPlaying: playing,
        togglePlaying: toggle,
        onSkip: skip,
        onFeedback: feedback,
      } = latestRef.current;
      if (!current) return;

      if (event.metaKey || event.ctrlKey) {
        if (!handlesTrackSkip || event.shiftKey) return;
        if (event.key === 'ArrowRight' && allowed.next) {
          event.preventDefault();
          skip(1);
          feedback('next');
        } else if (event.key === 'ArrowLeft' && allowed.previous) {
          event.preventDefault();
          skip(-1);
          feedback('previous');
        }
        return;
      }

      if (event.shiftKey || isInteractiveTarget(event.target)) return;

      if (event.key === ' ') {
        event.preventDefault();
        if (event.repeat || !allowed.play_pause) return;
        toggle();
        playbackPlayPause().catch(noop);
        feedback(playing ? 'pause' : 'play');
        return;
      }

      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && allowed.seek && current.duration_ms > 0) {
        event.preventDefault();
        const now = performance.now();
        const position = interpolatePosition(baselineRef.current, now, playing);
        const delta = event.key === 'ArrowRight' ? SEEK_STEP_MS : -SEEK_STEP_MS;
        const target = Math.max(0, Math.min(current.duration_ms, position + delta));
        baselineRef.current = { ms: target, at: now, targetMs: target, targetAt: now, blendDur: 1 };
        setPositionMs(target);
        playbackSeekMs(target).catch(noop);
        feedback(delta > 0 ? 'forward' : 'back');
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [baselineRef, setPositionMs]);
}
