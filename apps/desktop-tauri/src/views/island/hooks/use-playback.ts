import { useCallback, useRef, useState } from 'react';
import { usePlaybackSnapshot } from '@/hooks/use-playback-snapshot';
import {
  BLEND_MS,
  interpolatePosition,
  wordsKey,
  type PositionBaseline,
} from '@/utils/playback-sync';
import type { LyricWord, RenderSnapshot } from '@/types/tauri-contracts';
import { refreshLyrics } from '@/utils/tauri-commands';
import type { LyricsStatus } from '@/utils/lyrics-state';

const noop = (...args: unknown[]) => { if (args) return; };

export function useIslandPlayback({
  ensureWindowReady,
}: {
  ensureWindowReady: () => Promise<void>;
}) {
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [nextLine, setNextLine] = useState<string | null>(null);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [hasTrack, setHasTrack] = useState(false);
  const [hasVisibleLyrics, setHasVisibleLyrics] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [hasActiveLyric, setHasActiveLyric] = useState(false);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [activeLineProgress, setActiveLineProgress] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [trackKey, setTrackKey] = useState('');

  const refreshedUriRef = useRef('');
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
      setActiveLine(null);
      setNextLine(null);
      setHasActiveLyric(false);
      activeWordsKeyRef.current = '';
      setActiveLineWords([]);
      setActiveLineProgress(0);
      wordRefs.current = [];
    }

    setSnapshotReady(true);
    setHasTrack(Boolean(track));
    setHasVisibleLyrics(hasActiveLine);
    const playingNow = snap.playback.state === 'Playing';
    setIsPlaying(playingNow);
    setLyricsStatus(snap.lyrics_status);
    setArtworkUrl(track?.artwork_url ?? null);
    setTrackTitle(track?.title ?? '');
    setTrackArtist(track?.artist ?? '');
    setTrackKey(track?.uri ?? '');
    setDurationMs(track?.duration_ms ?? 0);
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

    if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
      refreshedUriRef.current = uri;
      refreshLyrics().catch(noop);
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

  return {
    activeLine,
    nextLine,
    artworkUrl,
    trackTitle,
    trackArtist,
    hasTrack,
    hasVisibleLyrics,
    isPlaying,
    lyricsStatus,
    snapshotReady,
    hasActiveLyric,
    activeLineWords,
    activeLineProgress,
    durationMs,
    trackKey,
    baselineRef,
    wordRefs,
  };
}
