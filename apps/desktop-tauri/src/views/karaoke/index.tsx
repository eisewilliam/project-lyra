import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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

type RenderSnapshot = {
  playback: { track: { uri: string } | null; state: 'Playing' | 'Paused' | 'Stopped' };
  lyrics_status: 'Loading' | 'Ready' | 'NotFound' | { Error: string };
  visible_lines: VisibleLine[];
};

function applyStyle(s: UiState) {
  const root = document.documentElement.style;
  root.setProperty('--font-scale', String(s.karaoke_font_scale));
  root.setProperty('--karaoke-align', s.karaoke_alignment);
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

export default function Karaoke() {
  const [activeLine, setActiveLine] = useState('');
  const [nextLine, setNextLine] = useState('');
  const [lines, setLines] = useState(2);
  const layoutTimerRef = useRef<number | null>(null);
  const refreshedUriRef = useRef('');
  const lastUriRef = useRef('');

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

        if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
          refreshedUriRef.current = uri;
          invoke('refresh_lyrics').catch(() => { });
        }

        if (uri !== lastUriRef.current) {
          lastUriRef.current = uri;
          setActiveLine('');
          setNextLine('');
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

  return (
    <div className="karaoke-root">
      <div className="karaoke-current">{activeLine}</div>
      {lines >= 2 && <div className="karaoke-next">{nextLine}</div>}
    </div>
  );
}

