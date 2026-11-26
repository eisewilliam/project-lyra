import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import type { UiState } from '@/types/tauri-contracts';

function resolveAlignment(alignment: UiState['karaoke_alignment']): 'left' | 'center' | 'right' {
  if (alignment === 'left' || alignment === 'right') return alignment;
  return 'center';
}

function getPlaceholderAlignment(alignment: 'left' | 'center' | 'right') {
  if (alignment === 'left') return 'flex-start';
  if (alignment === 'right') return 'flex-end';
  return 'center';
}

function applyStyle(s: UiState) {
  const root = document.documentElement.style;
  const alignment = resolveAlignment(s.karaoke_alignment);
  const bgOpacity = Number.isFinite(s.karaoke_bg_opacity)
    ? Math.max(0, Math.min(1, s.karaoke_bg_opacity))
    : 0;
  const isFloatingBand = s.karaoke_width_pct < 100 || s.karaoke_offset_px > 0;
  root.setProperty('--font-scale', String(Number.isFinite(s.karaoke_font_scale) ? s.karaoke_font_scale : 1));
  root.setProperty('--karaoke-align', alignment);
  root.setProperty('--karaoke-placeholder-align', getPlaceholderAlignment(alignment));
  root.setProperty('--karaoke-bg', String(bgOpacity));
  root.setProperty('--karaoke-radius', isFloatingBand ? '16px' : '0px');
  root.setProperty('--karaoke-weight', s.karaoke_bold ? '800' : '500');
}

function computeLogicalHeight(s: UiState, baseFontSize: number): number {
  const fontScale = Number.isFinite(s.karaoke_font_scale) ? s.karaoke_font_scale : 1;
  const currentLinePx = 4 * baseFontSize * fontScale * 1.15;
  const lineGapPx = 0.45 * baseFontSize * fontScale;
  const nextLinePx = s.karaoke_lines >= 2 ? 1.5 * baseFontSize * fontScale * 1.3 + lineGapPx : 0;
  const minLogicalHeight = s.karaoke_lines === 1 ? 110 : 180;
  return Math.max(minLogicalHeight, Math.ceil(currentLinePx + nextLinePx + 40));
}

async function applyLayout(s: UiState, baseFontSize = 16) {
  try {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const scaleFactor = monitor.scaleFactor || 1;
    const logicalHeight = computeLogicalHeight(s, baseFontSize);
    const height = Math.round(logicalHeight * scaleFactor);
    const offsetPx = Math.round(s.karaoke_offset_px * scaleFactor);
    const width = Math.round(monitor.workArea.size.width * (s.karaoke_width_pct / 100));
    const x = Math.round(
      monitor.workArea.size.width - width
    ) / 2;
    const computedX = Math.round(monitor.workArea.position.x + x);
    const computedY =
      s.karaoke_position === 'top'
        ? monitor.workArea.position.y + offsetPx
        : monitor.workArea.position.y + monitor.workArea.size.height - height - offsetPx;

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
  const latestUiRef = useRef<UiState | null>(null);
  const baseFontSizeRef = useRef(16);

  const scheduleLayout = (state: UiState, baseFontSize: number) => {
    if (layoutTimerRef.current) globalThis.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = globalThis.setTimeout(() => {
      applyLayout(state, baseFontSize).catch(() => {});
    }, 50);
  };

  useSurfaceSettings({
    ensureWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    getSurfaceVisible: (state) => state.karaoke_visible,
    onInitialUiState: async (state) => {
      latestUiRef.current = state;
      applyStyle(state);
      setLines(state.karaoke_lines);
      await applyLayout(state, baseFontSizeRef.current);
    },
    onUiStateChange: (state) => {
      latestUiRef.current = state;
      applyStyle(state);
      setLines(state.karaoke_lines);
      scheduleLayout(state, baseFontSizeRef.current);
    },
    onAppSettings: (settings) => {
      const nextFontSize = settings.appearance.font_size || 16;
      const changed = nextFontSize !== baseFontSizeRef.current;
      baseFontSizeRef.current = nextFontSize;
      if (changed && latestUiRef.current) {
        scheduleLayout(latestUiRef.current, nextFontSize);
      }
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
