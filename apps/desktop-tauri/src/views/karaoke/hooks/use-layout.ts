import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import type { UiState } from '@/types/tauri-contracts';

function getPlaceholderAlignment(alignment: UiState['karaoke_alignment']) {
  if (alignment === 'left') return 'flex-start';
  if (alignment === 'right') return 'flex-end';
  return 'center';
}

function applyStyle(s: UiState) {
  const root = document.documentElement.style;
  root.setProperty('--font-scale', String(Number.isFinite(s.karaoke_font_scale) ? s.karaoke_font_scale : 1));
  root.setProperty('--karaoke-align', s.karaoke_alignment);
  root.setProperty(
    '--karaoke-placeholder-align',
    getPlaceholderAlignment(s.karaoke_alignment),
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
      monitor.workArea.size.width - width
    ) / 2;
    const computedX = Math.round(monitor.workArea.position.x + x);
    const computedY =
      s.karaoke_position === 'top'
        ? monitor.workArea.position.y + s.karaoke_offset_px
        : monitor.workArea.position.y + monitor.workArea.size.height - height - s.karaoke_offset_px;

    await win.setSize(new PhysicalSize(width, height));
    await win.setPosition(new PhysicalPosition(computedX, computedY));
  } catch (e) {
    console.error(e);
  }
}

export function useKaraokeLayout({
  ensureWindowReady,
  desiredVisibleRef,
  autoHiddenRef,
  setSurfaceVisible,
  setHideWhenPaused,
  setHideWhenIdle,
}: {
  ensureWindowReady: () => Promise<void>;
  desiredVisibleRef: React.RefObject<boolean>;
  autoHiddenRef: React.RefObject<boolean>;
  setSurfaceVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setHideWhenPaused: React.Dispatch<React.SetStateAction<boolean>>;
  setHideWhenIdle: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [lines, setLines] = useState(2);
  const layoutTimerRef = useRef<number | null>(null);

  useSurfaceSettings({
    ensureWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    getSurfaceVisible: (state) => state.karaoke_visible,
    onInitialUiState: async (state) => {
      applyStyle(state);
      setLines(state.karaoke_lines);
      await applyLayout(state);
    },
    onUiStateChange: (state) => {
      applyStyle(state);
      setLines(state.karaoke_lines);
      if (layoutTimerRef.current) globalThis.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = globalThis.setTimeout(() => {
        applyLayout(state).catch(() => {});
      }, 50);
    },
    shouldReleaseAutoHide: (settings) => (
      !settings.behavior.hide_when_paused && !settings.window.hide_when_idle
    ),
  });

  useEffect(() => {
    return () => {
      if (layoutTimerRef.current) globalThis.clearTimeout(layoutTimerRef.current);
    };
  }, []);

  return lines;
}
export { applyStyle, applyLayout };
