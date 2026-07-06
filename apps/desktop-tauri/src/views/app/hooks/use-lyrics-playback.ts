import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackSnapshot } from '@/hooks/use-playback-snapshot';
import type { LyricWord, RenderSnapshot, TrackRef } from '@/types/tauri-contracts';
import {
  BLEND_MS,
  interpolatePosition,
  wordsKey,
  type PositionBaseline,
} from '@/utils/playback-sync';
import {
  getAllLines,
  getLyricOffset,
  playbackSeekMs,
  refreshLyrics,
} from '@/utils/tauri-commands';
import type { LineRef } from '../types';
import { noop, sameTrack } from '../utils';
import { useProgressBarDrag } from './use-progress-bar-drag';

export function useLyricsPlayback({
  ensureWindowReady,
}: {
  ensureWindowReady: () => Promise<void>;
}) {
  const [lyrics, setLyrics] = useState<LineRef[]>([]);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [track, setTrack] = useState<TrackRef | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<RenderSnapshot['lyrics_status']>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);

  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const lyricsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const lastUriRef = useRef('');
  const refreshedUriRef = useRef('');
  const lyricsLoadedUriRef = useRef('');
  const activeWordsKeyRef = useRef('');
  const offsetUriRef = useRef('');

  // Guard: when the user toggles play/pause, ignore the snapshot's
  // isPlaying state for a short window so stale polls don't cause the
  // icon to "fidget" back to the pre-toggle state.
  const playToggleAtRef = useRef(0);
  const PLAY_TOGGLE_GUARD_MS = 800;

  const {
    progressTrackRef,
    progressFillRef,
    positionLabelRef,
    handleMouseDown,
    isDragging,
  } = useProgressBarDrag({
    track,
    setPositionMs,
    baselineRef,
  });

  const lyricsRefForCb = useRef<LineRef[]>(lyrics);
  useEffect(() => {
    lyricsRefForCb.current = lyrics;
  }, [lyrics]);

  const seekToLine = useCallback((index: number, eventTimeStamp: number) => {
    const target = lyricsRefForCb.current[index]?.start_ms;
    if (target === undefined) return;
    const now = eventTimeStamp;
    baselineRef.current = { ms: target, at: now, targetMs: target, targetAt: now, blendDur: 1 };
    setPositionMs(target);
    setActiveLine(index);
    setActiveLineWords([]);
    playbackSeekMs(target).catch(noop);
  }, []);

  const applyPlaybackSnapshot = useCallback((snap: RenderSnapshot) => {
    const uri = snap.playback.track?.uri ?? '';
    const uriChanged = uri !== lastUriRef.current;

    if (uriChanged) {
      lastUriRef.current = uri;
      setLyrics([]);
      setActiveLine(null);
      activeWordsKeyRef.current = '';
      setActiveLineWords([]);
      lyricsLoadedUriRef.current = '';
      lyricsRef.current = [];
      wordRefs.current = [];

      if (uri && offsetUriRef.current !== uri) {
        offsetUriRef.current = uri;
        getLyricOffset()
          .then((ms) => setLyricOffsetMs(ms))
          .catch(() => setLyricOffsetMs(0));
      } else if (!uri) {
        offsetUriRef.current = '';
        setLyricOffsetMs(0);
      }
    }

    setSnapshotReady(true);
    const playingNow = snap.playback.state === 'Playing';

    // Only apply the snapshot's playing state if we're outside the
    // optimistic guard window (user hasn't recently toggled).
    const withinGuard = (performance.now() - playToggleAtRef.current) < PLAY_TOGGLE_GUARD_MS;
    if (!withinGuard) {
      setIsPlaying(playingNow);
    }
    setTrack((prev) => sameTrack(prev, snap.playback.track) ? prev : snap.playback.track);
    setLyricsStatus(snap.lyrics_status);

    const newPos = snap.playback.position_ms ?? 0;
    const now = performance.now();
    const ageMs = playingNow
      ? Math.max(0, Math.min(2000, Date.now() - snap.playback.observed_at_ms))
      : 0;
    const correctedPos = newPos + ageMs;
    const currentInterp = interpolatePosition(baselineRef.current, now, playingNow);
    const drift = correctedPos - currentInterp;

    if (!playingNow || Math.abs(drift) > 1000) {
      baselineRef.current = { ms: correctedPos, at: now, targetMs: correctedPos, targetAt: now, blendDur: 1 };
      if (!isDragging.current) {
        setPositionMs(correctedPos);
      }
    } else {
      baselineRef.current = { ms: currentInterp, at: now, targetMs: correctedPos, targetAt: now, blendDur: BLEND_MS };
    }

    setActiveLine(snap.active_line_index ?? null);
    const nextWords = snap.active_line_words ?? [];
    const nextWordsKey = wordsKey(nextWords);
    if (nextWordsKey !== activeWordsKeyRef.current) {
      activeWordsKeyRef.current = nextWordsKey;
      setActiveLineWords(nextWords);
    }

    if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
      refreshedUriRef.current = uri;
      refreshLyrics().catch(noop);
    }

    if (uri && snap.lyrics_status === 'Ready' && lyricsLoadedUriRef.current !== uri) {
      lyricsLoadedUriRef.current = uri;
      getAllLines()
        .then((lines) => setLyrics(lines.map((l) => ({ start_ms: l.start_ms, text: l.text }))))
        .catch(noop);
    }
  }, [isDragging]);

  usePlaybackSnapshot({
    ensureWindowReady,
    onSnapshot: applyPlaybackSnapshot,
  });

  const togglePlaying = useCallback(() => {
    playToggleAtRef.current = performance.now();
    setIsPlaying((p) => !p);
  }, []);

  return {
    lyrics,
    activeLine,
    isPlaying,
    setIsPlaying,
    togglePlaying,
    track,
    lyricsStatus,
    snapshotReady,
    positionMs,
    setPositionMs,
    activeLineWords,
    lyricOffsetMs,
    setLyricOffsetMs,
    baselineRef,
    lyricsRef,
    wordRefs,
    progressTrackRef,
    progressFillRef,
    positionLabelRef,
    handleMouseDown,
    seekToLine,
    isDragging,
  };
}
