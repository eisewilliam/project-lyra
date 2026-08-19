import type { RefObject, Dispatch, SetStateAction } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import { snapToTopEdge, setIslandPanelPosition } from './use-move';

const noop = (...args: unknown[]) => { if (args) return; };

function applyIslandFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function useIslandSettings({
  ensureWindowReady,
  desiredVisibleRef,
  autoHiddenRef,
  setSurfaceVisible,
  setHideWhenPaused,
  setHideWhenIdle,
  setLocked,
  setShowCover,
  setCoverCircle,
  setCoverSpin,
  setIslandHeight,
  setIsDocked,
}: {
  ensureWindowReady: () => Promise<void>;
  desiredVisibleRef: RefObject<boolean>;
  autoHiddenRef: RefObject<boolean>;
  setSurfaceVisible: Dispatch<SetStateAction<boolean>>;
  setHideWhenPaused: Dispatch<SetStateAction<boolean>>;
  setHideWhenIdle: Dispatch<SetStateAction<boolean>>;
  setLocked: Dispatch<SetStateAction<boolean>>;
  setShowCover: Dispatch<SetStateAction<boolean>>;
  setCoverCircle: Dispatch<SetStateAction<boolean>>;
  setCoverSpin: Dispatch<SetStateAction<boolean>>;
  setIslandHeight: Dispatch<SetStateAction<number>>;
  setIsDocked: Dispatch<SetStateAction<boolean>>;
}) {
  useSurfaceSettings({
    ensureWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    getSurfaceVisible: (state) => state.island_visible,
    onInitialUiState: async (state) => {
      const win = getCurrentWindow();
      setLocked(state.island_locked);
      setShowCover(state.island_show_cover ?? true);
      setCoverCircle(state.island_cover_circle ?? false);
      setCoverSpin(state.island_cover_spin ?? false);
      setIslandHeight(state.island_height ?? 72);
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
    },
    onUiStateChange: (state) => {
      setLocked(state.island_locked);
      setShowCover(state.island_show_cover ?? true);
      setCoverCircle(state.island_cover_circle ?? false);
      setCoverSpin(state.island_cover_spin ?? false);
      setIslandHeight(state.island_height ?? 72);
      applyIslandFont(state.island_font_scale);
      if (state.island_width && state.island_height) {
        getCurrentWindow().setSize(
          new LogicalSize(state.island_width, state.island_height)
        ).catch(noop);
      }
    },
    shouldReleaseAutoHide: (settings) => (
      !settings.behavior.hide_when_paused && !settings.window.hide_when_idle
    ),
  });
}
export { applyIslandFont, clamp };
