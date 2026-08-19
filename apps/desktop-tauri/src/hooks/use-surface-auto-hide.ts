import { useEffect, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { syncSurfaceVisible } from '@/utils/playback-sync';

export function useSurfaceAutoHide({
  snapshotReady,
  hideWhenPaused,
  hideWhenIdle,
  isPlaying,
  hasTrack,
  desiredVisibleRef,
  autoHiddenRef,
  setSurfaceVisible,
}: {
  snapshotReady: boolean;
  hideWhenPaused: boolean;
  hideWhenIdle: boolean;
  isPlaying: boolean;
  hasTrack: boolean;
  desiredVisibleRef: RefObject<boolean>;
  autoHiddenRef: RefObject<boolean>;
  setSurfaceVisible: (visible: boolean) => void;
}) {
  useEffect(() => {
    if (!snapshotReady) return;
    const win = getCurrentWindow();
    const shouldAutoHide = (hideWhenPaused && !isPlaying) || (hideWhenIdle && !hasTrack);
    if (shouldAutoHide && desiredVisibleRef.current) {
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, undefined, true);
      void win.hide();
    } else if (autoHiddenRef.current && !shouldAutoHide) {
      const visible = syncSurfaceVisible(
        desiredVisibleRef,
        autoHiddenRef,
        setSurfaceVisible,
        undefined,
        false,
      );
      if (visible) {
        void win.show();
      }
    }
  }, [
    autoHiddenRef,
    desiredVisibleRef,
    hasTrack,
    hideWhenIdle,
    hideWhenPaused,
    isPlaying,
    setSurfaceVisible,
    snapshotReady,
  ]);
}
