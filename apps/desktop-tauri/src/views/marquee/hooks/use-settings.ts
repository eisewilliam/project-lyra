import { useRef, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import type { UiState } from '@/types/tauri-contracts';

function applyMarqueeFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(Number.isFinite(scale) ? scale : 1));
}

export function useMarqueeSettings({
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
  setMarqueeLines,
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
  setMarqueeLines: Dispatch<SetStateAction<number>>;
  setBatterySaver: Dispatch<SetStateAction<boolean>>;
  setTransparency: Dispatch<SetStateAction<number>>;
}) {
  // The marquee's own idle setting, not the main window's; read when app
  // settings change to decide whether auto-hide can be released.
  const hideWhenIdleRef = useRef(true);
  // The host places the marquee (see `marquee_size.rs`); this only mirrors
  // its settings.
  const applyUiState = (state: UiState) => {
    setLocked(state.marquee_locked);
    setShowCover(state.marquee_show_cover ?? true);
    setCoverCircle(state.marquee_cover_circle ?? false);
    setCoverSpin(state.marquee_cover_spin ?? false);
    setMarqueeLines(state.marquee_lines ?? 2);
    setTransparency(state.marquee_transparency ?? 0.5);
    hideWhenIdleRef.current = state.marquee_hide_when_idle ?? true;
    setHideWhenIdle(hideWhenIdleRef.current);
    applyMarqueeFont(state.marquee_font_scale);
  };

  useSurfaceSettings({
    ensureWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    getSurfaceVisible: (state) => state.marquee_visible,
    onInitialUiState: applyUiState,
    onUiStateChange: applyUiState,
    onAppSettings: (settings) => setBatterySaver(settings.behavior.battery_saver),
    shouldReleaseAutoHide: (settings) => (
      !settings.behavior.hide_when_paused && !hideWhenIdleRef.current
    ),
  });
}
export { applyMarqueeFont };
