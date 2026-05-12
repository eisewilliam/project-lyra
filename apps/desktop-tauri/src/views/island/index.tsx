import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './island.css';

type UiState = {
  island_visible: boolean;
  floating_visible: boolean;
  karaoke_visible: boolean;
  island_locked: boolean;
  island_pos: [number, number] | null;
  island_width: number | null;
  island_height: number | null;
  island_font_scale: number;
  karaoke_font_scale: number;
  floating_font_scale: number;
};

type VisibleLine = { index: number; text: string; is_active: boolean };

type RenderSnapshot = {
  playback: {
    track: { artwork_url: string | null } | null;
    state: 'Playing' | 'Paused' | 'Stopped';
  };
  lyrics_status: 'Loading' | 'Ready' | 'NotFound' | { Error: string };
  visible_lines: VisibleLine[];
};

const TOP_DOCK_SNAP_PX = 80;
const POLL_MS = 300;
const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

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
  const [activeLine, setActiveLine] = useState('');
  const [nextLine, setNextLine] = useState('');
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [isDocked, setIsDocked] = useState(true);
  const saveTimerRef = useRef<number | null>(null);
  const refreshedUriRef = useRef('');
  const lastUriRef = useRef('');

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
        if (e.payload.island_width && e.payload.island_height) {
          getCurrentWindow().setSize(
            new PhysicalSize(e.payload.island_width, e.payload.island_height)
          ).catch(() => { });
        }
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

  // Poll real render snapshot every 300 ms.
  useEffect(() => {
    const poll = async () => {
      try {
        const snap = await invoke<RenderSnapshot>('get_render_snapshot');
        const uri = snap.playback.track
          ? (snap.playback.track as unknown as { uri: string }).uri
          : '';

        setArtworkUrl(snap.playback.track?.artwork_url ?? null);

        // Trigger lyrics fetch once per URI.
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

  const artSrc = artworkUrl ?? FALLBACK_ART;

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
        <img src={artSrc} alt="" className="island-bg-img" />
        <div className="island-bg-dimmer"></div>
      </div>

      <div className="panel-content">
        <div className="panel-art">
          <img src={artSrc} className="panel-cover" draggable={false} alt="Album" />
        </div>

        <div className="panel-lyrics-stack">
          <div className="panel-lyric-active">
            {activeLine}
          </div>
          <div className="panel-lyric-next">
            {nextLine}
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

