import { useRef, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import type { UiState } from '@/types/tauri-contracts';

function applyIslandFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(Number.isFinite(scale) ? scale : 1));
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
  setIslandLines,
  setBatterySaver,
  setTransparency,
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
  setIslandLines: Dispatch<SetStateAction<number>>;
  setBatterySaver: Dispatch<SetStateAction<boolean>>;
  setTransparency: Dispatch<SetStateAction<number>>;
}) {
  // The island's own idle setting, not the main window's; read when app
  // settings change to decide whether auto-hide can be released.
  const hideWhenIdleRef = useRef(true);
  // The host places the island (see `island_size.rs`); this only mirrors
  // its settings.
  const applyUiState = (state: UiState) => {
    setLocked(state.island_locked);
    setShowCover(state.island_show_cover ?? true);
    setCoverCircle(state.island_cover_circle ?? false);
    setCoverSpin(state.island_cover_spin ?? false);
    setIslandLines(state.island_lines ?? 2);
    setTransparency(state.island_transparency ?? 0.5);
    hideWhenIdleRef.current = state.island_hide_when_idle ?? true;
    setHideWhenIdle(hideWhenIdleRef.current);
    applyIslandFont(state.island_font_scale);
  };

  useSurfaceSettings({
    ensureWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    getSurfaceVisible: (state) => state.island_visible,
    onInitialUiState: applyUiState,
    onUiStateChange: applyUiState,
    onAppSettings: (settings) => setBatterySaver(settings.behavior.battery_saver),
    shouldReleaseAutoHide: (settings) => (
      !settings.behavior.hide_when_paused && !hideWhenIdleRef.current
    ),
  });
}
export { applyIslandFont };
