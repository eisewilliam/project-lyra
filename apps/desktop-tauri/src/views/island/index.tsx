import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MOCK_LYRICS, ALBUM_COVER } from '../../constants';
import './island.css';

type UiState = {
  island_visible: boolean;
  floating_visible: boolean;
  karaoke_visible: boolean;
  island_locked: boolean;
  island_pos: [number, number] | null;
  island_font_scale: number;
  karaoke_font_scale: number;
  floating_font_scale: number;
};

const TOP_DOCK_SNAP_PX = 80;

function applyIslandFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToTopEdge(value: number, topEdge: number) {
  return value <= topEdge + TOP_DOCK_SNAP_PX ? topEdge : value;
}

async function setIslandPanelPosition(x: number, y: number) {
  await invoke('set_overlay_position', { label: 'island', x, y });
}

export default function Island() {
  const [activeLine, setActiveLine] = useState(3);
  const [isPlaying] = useState(true);
  const [locked, setLocked] = useState(true);
  const [isDocked, setIsDocked] = useState(true);
  const saveTimerRef = useRef<number | null>(null);

  // Init: read persisted state, position window, subscribe to lock + settings changes.
  useEffect(() => {
    let unlistenLock: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;

    (async () => {
      const win = getCurrentWindow();
      const state = await invoke<UiState>('get_ui_state');
      setLocked(state.island_locked);
      applyIslandFont(state.island_font_scale);

      try {
        const monitor = await currentMonitor();
        const size = await win.outerSize();

        if (monitor) {
          const minX = monitor.position.x;
          const maxX = monitor.position.x + monitor.size.width - size.width;
          const minY = monitor.position.y;
          const maxY = monitor.position.y + monitor.size.height - size.height;

          const [rawX, rawY] = state.island_pos ?? [
            Math.round(monitor.position.x + (monitor.size.width - size.width) / 2),
            minY,
          ];

          const x = clamp(rawX, minX, Math.max(minX, maxX));
          const y = clamp(snapToTopEdge(rawY, minY), minY, Math.max(minY, maxY));

          setIsDocked(y <= minY + 1);
          await setIslandPanelPosition(x, y);
        }
      } catch (e) {
        console.error(e);
      }

      unlistenLock = await listen<boolean>('island-lock-changed', (e) => {
        setLocked(e.payload);
      });

      unlistenSettings = await listen<UiState>('ui-settings-changed', (e) => {
        setLocked(e.payload.island_locked);
        applyIslandFont(e.payload.island_font_scale);
      });

      unlistenMove = await win.onMoved(({ payload }) => {
        currentMonitor().then((monitor) => {
          if (!monitor) {
            return;
          }

          const snappedY = snapToTopEdge(payload.y, monitor.position.y);
          setIsDocked(snappedY <= monitor.position.y + 1);

          if (snappedY !== payload.y) {
            void setIslandPanelPosition(payload.x, snappedY).catch(() => { });
          }

          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            invoke('save_island_position', { x: payload.x, y: snappedY }).catch(() => { });
          }, 250);
        }).catch(() => { });
      });
    })();

    return () => {
      unlistenLock?.();
      unlistenMove?.();
      unlistenSettings?.();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setActiveLine(prev => (prev + 1) % MOCK_LYRICS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [isPlaying]);

  return (
    <div
      className={`floating-panel ${locked ? 'locked' : 'unlocked'} ${isDocked ? 'docked' : 'floating'}`}
      onMouseDown={(e) => {
        if (locked || e.button !== 0) return;
        e.preventDefault();
        void getCurrentWindow().startDragging();
      }}
    >
      <div className="island-background">
        <img src={ALBUM_COVER} alt="" className="island-bg-img" />
        <div className="island-bg-dimmer"></div>
      </div>

      <div className="panel-content">
        <div className="panel-art">
          <img src={ALBUM_COVER} className="panel-cover" draggable={false} alt="Album" />
        </div>

        <div className="panel-lyrics-stack">
          <div className="panel-lyric-active">
            {MOCK_LYRICS[activeLine]}
          </div>
          <div className="panel-lyric-next">
            {MOCK_LYRICS[(activeLine + 1) % MOCK_LYRICS.length]}
          </div>
        </div>

        <div className="audio-bars">
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </div>
      </div>
    </div>
  );
}
