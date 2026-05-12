import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MOCK_LYRICS } from '../../constants';
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

export default function Karaoke() {
  const [activeLine, setActiveLine] = useState(3);
  const [lines, setLines] = useState(2);
  const layoutTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveLine(prev => (prev + 1) % MOCK_LYRICS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const next = (activeLine + 1) % MOCK_LYRICS.length;

  return (
    <div className="karaoke-root">
      <div className="karaoke-current">{MOCK_LYRICS[activeLine]}</div>
      {lines >= 2 && <div className="karaoke-next">{MOCK_LYRICS[next]}</div>}
    </div>
  );
}
