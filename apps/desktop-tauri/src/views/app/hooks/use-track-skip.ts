import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import { playbackNext, playbackPrevious } from '@/utils/tauri-commands';
import { noop } from '../utils';

export type SkipDirection = 1 | -1;

/** Give up on the dimmed "switching" state if no new track arrives. */
const SWITCH_TIMEOUT_MS = 2000;
/** Players restart the current track on Previous past this point. */
const PREVIOUS_RESTARTS_AFTER_MS = 3000;

type SkipState = {
  uri: string;
  /** A skip was requested and its track hasn't arrived yet. */
  switching: boolean;
};

/**
 * Next/previous with immediate feedback: the lyrics dim the moment a skip is
 * requested, not when the new track finally arrives.
 */
export function useTrackSkip({
  trackUri,
  isPlaying,
  baselineRef,
}: {
  trackUri: string;
  isPlaying: boolean;
  baselineRef: RefObject<PositionBaseline>;
}) {
  const [state, setState] = useState<SkipState>({ uri: trackUri, switching: false });
  const timerRef = useRef(0);

  // The new track has arrived: end the dimmed state in the same render.
  if (state.uri !== trackUri) {
    setState({ uri: trackUri, switching: false });
  }

  /** Show a skip's feedback without sending it (the native menu sends it). */
  const markSkip = useCallback((direction: SkipDirection) => {
    const restarts = direction < 0
      && interpolatePosition(baselineRef.current, performance.now(), isPlaying) > PREVIOUS_RESTARTS_AFTER_MS;
    if (restarts) return;
    setState((current) => ({ ...current, switching: true }));
    globalThis.clearTimeout(timerRef.current);
    timerRef.current = globalThis.setTimeout(() => {
      setState((current) => ({ ...current, switching: false }));
    }, SWITCH_TIMEOUT_MS);
  }, [baselineRef, isPlaying]);

  const skip = useCallback((direction: SkipDirection) => {
    markSkip(direction);
    (direction > 0 ? playbackNext() : playbackPrevious()).catch(noop);
  }, [markSkip]);

  useEffect(() => () => globalThis.clearTimeout(timerRef.current), []);

  return { skip, markSkip, switching: state.switching };
}
