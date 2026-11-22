import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackSnapshot } from '@/hooks/use-playback-snapshot';
import type {
  IgnoredMedia,
  LyricsOrigin,
  LyricWord,
  PlaybackCaps,
  RenderSnapshot,
  TrackRef,
} from '@/types/tauri-contracts';
import {
  BLEND_MS,
  NO_PLAYBACK_CAPS,
  interpolatePosition,
  sameCaps,
  wordsKey,
  type PositionBaseline,
} from '@/utils/playback-sync';
import {
  getAllLines,
  getPlainLyrics,
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
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LineRef[]>([]);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [track, setTrack] = useState<TrackRef | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<RenderSnapshot['lyrics_status']>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [vocalCountdown, setVocalCountdown] = useState<number | null>(null);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const [caps, setCaps] = useState<PlaybackCaps>(NO_PLAYBACK_CAPS);
  const [ignoredMedia, setIgnoredMedia] = useState<IgnoredMedia | null>(null);
  const [lyricsOrigin, setLyricsOrigin] = useState<LyricsOrigin>(AUTOMATIC_ORIGIN);
  const seekContext = useRef({ enabled: false, durationMs: 0, offsetMs: 0 });

  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const lyricsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const lastUriRef = useRef('');
  const refreshedUriRef = useRef('');
  const lyricsLoadedUriRef = useRef('');
  const activeWordsKeyRef = useRef('');

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
    canSeek: caps.seek,
    setPositionMs,
    baselineRef,
  });

  const lyricsRefForCb = useRef<LineRef[]>(lyrics);
  useEffect(() => {
    lyricsRefForCb.current = lyrics;
  }, [lyrics]);

  const seekToLine = useCallback((index: number, eventTimeStamp: number) => {
    const lineStart = lyricsRefForCb.current[index]?.start_ms;
    // Players that cannot seek keep their position; do not move the UI.
    const { enabled, durationMs, offsetMs } = seekContext.current;
    if (lineStart === undefined || !enabled) return;
    const target = Math.max(0, Math.min(durationMs || Infinity, lineStart + offsetMs));
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
      setPlainLyrics(null);
      setActiveLine(null);
      activeWordsKeyRef.current = '';
      setActiveLineWords([]);
      lyricsLoadedUriRef.current = '';
      lyricsRef.current = [];
      wordRefs.current = [];

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
    const offsetMs = snap.lyric_offset_ms ?? 0;
    seekContext.current = {
      enabled: snap.playback.caps.seek,
      durationMs: snap.playback.track?.duration_ms ?? 0,
      offsetMs,
    };
    setCaps((prev) => sameCaps(prev, snap.playback.caps) ? prev : snap.playback.caps);
    const ignored = snap.playback.ignored;
    setIgnoredMedia((prev) => (
      prev?.track_key === ignored?.track_key && prev?.reason === ignored?.reason ? prev : ignored
    ));
    setLyricsStatus(snap.lyrics_status);
    const origin = snap.lyrics_origin ?? AUTOMATIC_ORIGIN;
    setLyricsOrigin((prev) => (sameOrigin(prev, origin) ? prev : origin));

    const revision = snap.lyrics_revision ?? 0;
    setLyricOffsetMs(offsetMs);
    setVocalCountdown(snap.vocal_cue?.seconds ?? null);

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

    // Once per track and revision: going back to automatic lyrics that were
    // never cached needs a lookup for a track already looked up.
    const lyricsKey = `${uri}:${revision}`;
    if (uri && snap.lyrics_status === 'Loading') {
      if (refreshedUriRef.current !== lyricsKey) {
        refreshedUriRef.current = lyricsKey;
        refreshLyrics().catch(noop);
      }
    } else {
      // A settled status re-arms the request, so a track played again (core
      // forgets its earlier failure) is looked up instead of left loading.
      refreshedUriRef.current = '';
    }

    const contentKey = `${lyricsKey}:${snap.lyrics_status}`;
    if (uri && (snap.lyrics_status === 'Ready' || snap.lyrics_status === 'Unsynced')
      && lyricsLoadedUriRef.current !== contentKey) {
      lyricsLoadedUriRef.current = contentKey;
      const request = snap.lyrics_status === 'Unsynced'
        ? getPlainLyrics().then((plain) => {
          if (lastUriRef.current !== uri || lyricsLoadedUriRef.current !== contentKey) return;
          setPlainLyrics(plain);
          setLyrics([]);
        })
        : getAllLines().then((lines) => {
          if (lastUriRef.current !== uri || lyricsLoadedUriRef.current !== contentKey) return;
          setPlainLyrics(null);
          setLyrics(lines.map((l) => ({ start_ms: l.start_ms, text: l.text })));
        });
      request.catch(() => {
        if (lyricsLoadedUriRef.current === contentKey) lyricsLoadedUriRef.current = '';
      });
    } else if (snap.lyrics_status === 'Loading') {
      lyricsLoadedUriRef.current = '';
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
    plainLyrics,
    activeLine,
    isPlaying,
    setIsPlaying,
    togglePlaying,
    track,
    caps,
    ignoredMedia,
    lyricsStatus,
    lyricsOrigin,
    snapshotReady,
    positionMs,
    setPositionMs,
    activeLineWords,
    lyricOffsetMs,
    vocalCountdown,
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

const AUTOMATIC_ORIGIN: LyricsOrigin = { kind: 'automatic' };

function sameOrigin(a: LyricsOrigin, b: LyricsOrigin): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'picked' && b.kind === 'picked') return a.id === b.id;
  if (a.kind === 'imported' && b.kind === 'imported') return a.name === b.name;
  return true;
}
