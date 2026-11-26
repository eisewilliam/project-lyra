import { useCallback, useRef, useState } from 'react';
import { usePlaybackSnapshot } from '@/hooks/use-playback-snapshot';
import {
  BLEND_MS,
  NO_PLAYBACK_CAPS,
  interpolatePosition,
  sameCaps,
  wordsKey,
  type PositionBaseline,
} from '@/utils/playback-sync';
import type { LyricLineSlim, LyricWord, PlaybackCaps, RenderSnapshot } from '@/types/tauri-contracts';
import { getAllLines, refreshLyrics } from '@/utils/tauri-commands';
import type { LyricsStatus } from '@/utils/lyrics-state';

const noop = (...args: unknown[]) => { if (args) return; };
const PLAY_TOGGLE_GUARD_MS = 800;

export function useMarqueePlayback({
  ensureWindowReady,
}: {
  ensureWindowReady: () => Promise<void>;
}) {
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [vocalCue, setVocalCue] = useState<RenderSnapshot['vocal_cue']>(null);
  const [nextLine, setNextLine] = useState<string | null>(null);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [hasTrack, setHasTrack] = useState(false);
  const [hasVisibleLyrics, setHasVisibleLyrics] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [caps, setCaps] = useState<PlaybackCaps>(NO_PLAYBACK_CAPS);
  // A play/pause click flips the icon at once; snapshots inside this window
  // can still carry the old state and must not flip it back.
  const playToggleAtRef = useRef(0);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [hasActiveLyric, setHasActiveLyric] = useState(false);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [activeLineProgress, setActiveLineProgress] = useState(0);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const [lyricsRevision, setLyricsRevision] = useState(0);
  const [allLines, setAllLines] = useState<LyricLineSlim[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [trackKey, setTrackKey] = useState('');

  const refreshedUriRef = useRef('');
  const linesLoadedKeyRef = useRef('');
  const lastUriRef = useRef('');
  const activeWordsKeyRef = useRef('');
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const applyPlaybackSnapshot = useCallback((snap: RenderSnapshot) => {
    const track = snap.playback.track;
    const uri = track?.uri ?? '';
    const uriChanged = uri !== lastUriRef.current;
    const activeIdx = snap.visible_lines.findIndex((line) => line.is_active);
    const hasActiveLine = activeIdx !== -1;

    if (uriChanged) {
      lastUriRef.current = uri;
      linesLoadedKeyRef.current = '';
      setActiveLine(null);
      setNextLine(null);
      setHasActiveLyric(false);
      setActiveLineIndex(null);
      setLyricOffsetMs(0);
      setAllLines([]);
      activeWordsKeyRef.current = '';
      setActiveLineWords([]);
      setActiveLineProgress(0);
      wordRefs.current = [];
    }

    setSnapshotReady(true);
    setVocalCue((current) => current?.seconds === snap.vocal_cue?.seconds
      && current?.next_line === snap.vocal_cue?.next_line ? current : snap.vocal_cue ?? null);
    setHasTrack(Boolean(track));
    setHasVisibleLyrics(hasActiveLine);
    const playingNow = snap.playback.state === 'Playing';
    if (performance.now() - playToggleAtRef.current > PLAY_TOGGLE_GUARD_MS) {
      setIsPlaying(playingNow);
    }
    setCaps((prev) => (sameCaps(prev, snap.playback.caps) ? prev : snap.playback.caps));
    setLyricsStatus(snap.lyrics_status);
    setArtworkUrl(track?.artwork_url ?? null);
    setTrackTitle(track?.title ?? '');
    setTrackArtist(track?.artist ?? '');
    setTrackKey(track?.uri ?? '');
    setDurationMs(track?.duration_ms ?? 0);
    setActiveLineIndex(snap.active_line_index ?? null);
    setLyricOffsetMs(snap.lyric_offset_ms ?? 0);
    const revision = snap.lyrics_revision ?? 0;
    setLyricsRevision(revision);
    const nextWords = snap.active_line_words ?? [];
    const nextWordsKey = wordsKey(nextWords);
    if (nextWordsKey !== activeWordsKeyRef.current) {
      activeWordsKeyRef.current = nextWordsKey;
      setActiveLineWords(nextWords);
    }
    setActiveLineProgress(Math.max(0, Math.min(1, snap.line_progress ?? 0)));

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
    } else {
      baselineRef.current = { ms: currentInterp, at: now, targetMs: correctedPos, targetAt: now, blendDur: BLEND_MS };
    }

    if (uri && snap.lyrics_status === 'Loading') {
      if (refreshedUriRef.current !== uri) {
        refreshedUriRef.current = uri;
        refreshLyrics().catch(noop);
      }
    } else {
      // A settled status re-arms the request, so a track played again (core
      // forgets its earlier failure) is looked up instead of left loading.
      refreshedUriRef.current = '';
    }

    const linesKey = `${uri}:${revision}`;
    if (uri && snap.lyrics_status === 'Ready') {
      if (linesLoadedKeyRef.current !== linesKey) {
        linesLoadedKeyRef.current = linesKey;
        getAllLines()
          .then((lines) => {
            if (lastUriRef.current !== uri || linesLoadedKeyRef.current !== linesKey) return;
            setAllLines(lines);
          })
          .catch(() => {
            if (linesLoadedKeyRef.current === linesKey) linesLoadedKeyRef.current = '';
          });
      }
    } else {
      linesLoadedKeyRef.current = '';
      setAllLines((prev) => (prev.length === 0 ? prev : []));
    }

    setHasActiveLyric(hasActiveLine);
    if (hasActiveLine) {
      const currentLine = snap.visible_lines[activeIdx];
      const nextLineContent = snap.visible_lines[activeIdx + 1];
      if (!currentLine) return;
      setActiveLine(currentLine.text);
      setNextLine(nextLineContent ? nextLineContent.text : null);
    } else {
      setActiveLine(null);
      setNextLine(null);
    }
  }, []);

  usePlaybackSnapshot({
    ensureWindowReady,
    onSnapshot: applyPlaybackSnapshot,
  });

  const togglePlaying = useCallback(() => {
    playToggleAtRef.current = performance.now();
    setIsPlaying((playing) => !playing);
  }, []);

  return {
    activeLine,
    vocalCue,
    nextLine,
    artworkUrl,
    trackTitle,
    trackArtist,
    hasTrack,
    hasVisibleLyrics,
    isPlaying,
    togglePlaying,
    caps,
    lyricsStatus,
    snapshotReady,
    hasActiveLyric,
    activeLineWords,
    activeLineProgress,
    activeLineIndex,
    lyricOffsetMs,
    lyricsRevision,
    allLines,
    durationMs,
    trackKey,
    baselineRef,
    wordRefs,
  };
}
