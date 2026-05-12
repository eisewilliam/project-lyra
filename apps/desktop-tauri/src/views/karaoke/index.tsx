import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
  type LyricsStatus,
} from '../../utils/lyrics-state';
import { LyricsPlaceholderIcon } from '../../utils/lyrics-placeholder-icon';
import './karaoke.css';

type UiState = {
  karaoke_font_scale: number;
  karaoke_position: string;
  karaoke_alignment: string;
  karaoke_width_pct: number;
  karaoke_offset_px: number;
  karaoke_lines: number;
  karaoke_bg_opacity: number;
  karaoke_bold: boolean;
};

type VisibleLine = { index: number; text: string; is_active: boolean };

type LyricWord = { start_ms: number; end_ms: number; text: string };

type RenderSnapshot = {
  playback: {
    track: { uri: string } | null;
    state: 'Playing' | 'Paused' | 'Stopped';
    position_ms: number | null;
    observed_at_ms: number;
  };
  lyrics_status: LyricsStatus;
  visible_lines: VisibleLine[];
  active_line_words: LyricWord[] | null;
};

function applyStyle(s: UiState) {
  const root = document.documentElement.style;
  root.setProperty('--font-scale', String(s.karaoke_font_scale));
  root.setProperty('--karaoke-align', s.karaoke_alignment);
  root.setProperty(
    '--karaoke-placeholder-align',
    s.karaoke_alignment === 'left'
      ? 'flex-start'
      : s.karaoke_alignment === 'right'
        ? 'flex-end'
        : 'center',
  );
  root.setProperty('--karaoke-bg', String(s.karaoke_bg_opacity));
  root.setProperty('--karaoke-weight', s.karaoke_bold ? '800' : '500');
}

async function applyLayout(s: UiState) {
  try {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const height = s.karaoke_lines === 1 ? 110 : 180;
    const width = Math.round(monitor.workArea.size.width * (s.karaoke_width_pct / 100));
    const x = Math.round(
      monitor.workArea.position.x + (monitor.workArea.size.width - width) / 2,
    );
    const y =
      s.karaoke_position === 'top'
        ? monitor.workArea.position.y + s.karaoke_offset_px
        : monitor.workArea.position.y + monitor.workArea.size.height - height - s.karaoke_offset_px;

    await win.setSize(new PhysicalSize(width, height));
    await win.setPosition(new PhysicalPosition(x, y));
  } catch (e) {
    console.error(e);
  }
}

const POLL_MS = 300;
const BLEND_MS = 500;

type PositionBaseline = {
  ms: number;
  at: number;
  targetMs: number;
  targetAt: number;
  blendDur: number;
};

function interpolatePosition(b: PositionBaseline, now: number, playing: boolean): number {
  if (!playing) return b.ms;
  const currentTraj = b.ms + (now - b.at);
  const targetTraj = b.targetMs + (now - b.targetAt);
  const elapsed = now - b.at;
  if (elapsed >= b.blendDur) return targetTraj;
  const t = elapsed / Math.max(1, b.blendDur);
  return currentTraj * (1 - t) + targetTraj * t;
}

export default function Karaoke() {
  const [activeLine, setActiveLine] = useState('');
  const [nextLine, setNextLine] = useState('');
  const [hasTrack, setHasTrack] = useState(false);
  const [hasVisibleLyrics, setHasVisibleLyrics] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [lines, setLines] = useState(2);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const layoutTimerRef = useRef<number | null>(null);
  const refreshedUriRef = useRef('');
  const lastUriRef = useRef('');
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const state = await invoke<UiState>('get_ui_state');
      applyStyle(state);
      setLines(state.karaoke_lines);
      await applyLayout(state);

      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        applyStyle(e.payload);
        setLines(e.payload.karaoke_lines);
        if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = window.setTimeout(() => applyLayout(e.payload), 50);
      });
    })();
    return () => {
      unlisten?.();
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
    };
  }, []);

  // Poll real render snapshot every 300 ms.
  useEffect(() => {
    const poll = async () => {
      try {
        const snap = await invoke<RenderSnapshot>('get_render_snapshot');
        const uri = snap.playback.track?.uri ?? '';

        setSnapshotReady(true);
        setHasTrack(Boolean(snap.playback.track));
        setHasVisibleLyrics(snap.visible_lines.length > 0);
        setLyricsStatus(snap.lyrics_status);
        const playingNow = snap.playback.state === 'Playing';
        setIsPlaying(playingNow);
        setActiveLineWords(snap.active_line_words ?? []);

        // Age-corrected position + continuous blend. See app view for details.
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
          invoke('refresh_lyrics').catch(() => { });
        }

        if (uri !== lastUriRef.current) {
          lastUriRef.current = uri;
          setActiveLine('');
          setNextLine('');
          setActiveLineWords([]);
        }

        const activeIdx = snap.visible_lines.findIndex(l => l.is_active);
        if (activeIdx !== -1) {
          setActiveLine(snap.visible_lines[activeIdx].text);
          setNextLine(snap.visible_lines[activeIdx + 1]?.text ?? '');
        } else if (snap.visible_lines.length > 0) {
          setActiveLine(snap.visible_lines[0].text);
          setNextLine(snap.visible_lines[1]?.text ?? '');
        }
      } catch {
        // Ignore transient errors.
      }
    };

    const timer = setInterval(poll, POLL_MS);
    void poll();
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeLineWords.length === 0) return;
    let raf = 0;
    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      for (let i = 0; i < activeLineWords.length; i++) {
        const w = activeLineWords[i];
        const el = wordRefs.current[i];
        if (!el) continue;
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
        if (el.className !== cls) el.className = cls;
        el.style.setProperty('--word-progress', progress.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeLineWords, isPlaying]);

  const karaokeState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: hasVisibleLyrics,
  });

  return (
    <div className={`karaoke-root ${karaokeState !== 'ready' ? 'is-placeholder' : ''}`}>
      {karaokeState === 'ready' ? (
        <>
          <div className="karaoke-current">
            {activeLineWords.length > 0 ? (
              activeLineWords.map((w, i) => (
                <span
                  key={i}
                  ref={(el) => { wordRefs.current[i] = el; }}
                  className="lyric-word upcoming"
                >{w.text}</span>
              ))
            ) : activeLine}
          </div>
          {lines >= 2 && <div className="karaoke-next">{nextLine}</div>}
        </>
      ) : (
        <KaraokePlaceholder state={karaokeState} lines={lines} />
      )}
    </div>
  );
}

function KaraokePlaceholder({
  state,
  lines,
}: {
  state: LyricsPlaceholderState;
  lines: number;
}) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <div className={`karaoke-placeholder is-${state} ${loading ? 'is-loading' : ''}`} role="status" aria-label={getCompactPlaceholderLabel(state)}>
      <div className="karaoke-placeholder-orb" aria-hidden="true">
        <span className="karaoke-placeholder-ring" />
        <span className="karaoke-placeholder-core">
          <LyricsPlaceholderIcon state={state} className="karaoke-placeholder-icon" />
        </span>
      </div>
      {loading ? (
        <div className="karaoke-placeholder-dots" aria-hidden="true">
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
        </div>
      ) : lines >= 2 ? <div className="karaoke-placeholder-spacer" aria-hidden="true" /> : null}
    </div>
  );
}

function getCompactPlaceholderLabel(state: LyricsPlaceholderState) {
  switch (state) {
    case 'booting':
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'empty':
      return 'No synced lyrics';
    case 'error':
      return 'Lyrics unavailable';
    default:
      return '';
  }
}

