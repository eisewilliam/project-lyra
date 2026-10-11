import { useEffect, useRef, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AppSettings, UiState } from '@/types/tauri-contracts';
import { applyAppearance, applyBatterySaver } from '@/utils/app-settings';
import { syncSurfaceVisible } from '@/utils/playback-sync';
import { getSettings, getUiState } from '@/utils/tauri-commands';

type MaybePromise<T> = T | Promise<T>;

type UseSurfaceSettingsOptions = {
  ensureWindowReady: () => Promise<void>;
  desiredVisibleRef: RefObject<boolean>;
  autoHiddenRef: RefObject<boolean>;
  setSurfaceVisible: (visible: boolean) => void;
  setHideWhenPaused: (enabled: boolean) => void;
  setHideWhenIdle: (enabled: boolean) => void;
  getSurfaceVisible: (state: UiState) => boolean;
  onInitialUiState?: (state: UiState) => MaybePromise<void>;
  onUiStateChange?: (state: UiState) => void;
  onAppSettings?: (settings: AppSettings) => void;
  shouldReleaseAutoHide?: (settings: AppSettings) => boolean;
};

export function useSurfaceSettings(options: UseSurfaceSettingsOptions) {
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    let unlistenUiSettings: (() => void) | undefined;
    let unlistenAppSettings: (() => void) | undefined;
    let cancelled = false;

    const applyAppSettings = (settings: AppSettings) => {
      const current = optionsRef.current;
      current.setHideWhenPaused(settings.behavior.hide_when_paused);
      current.setHideWhenIdle(settings.window.hide_when_idle);
      applyAppearance(settings.appearance);
      applyBatterySaver(settings.behavior);
      current.onAppSettings?.(settings);
    };

    void (async () => {
      const current = optionsRef.current;
      await current.ensureWindowReady();
      if (cancelled) return;

      const [uiState, appSettings] = await Promise.all([
        getUiState(),
        getSettings(),
      ]);
      if (cancelled) return;

      applyAppSettings(appSettings);
      syncSurfaceVisible(
        current.desiredVisibleRef,
        current.autoHiddenRef,
        current.setSurfaceVisible,
        current.getSurfaceVisible(uiState),
      );
      await current.onInitialUiState?.(uiState);
      if (cancelled) return;

      unlistenUiSettings = await listen<UiState>('ui-settings-changed', (event) => {
        const latest = optionsRef.current;
        syncSurfaceVisible(
          latest.desiredVisibleRef,
          latest.autoHiddenRef,
          latest.setSurfaceVisible,
          latest.getSurfaceVisible(event.payload),
        );
        latest.onUiStateChange?.(event.payload);
      });
      if (cancelled) {
        unlistenUiSettings();
        return;
      }

      unlistenAppSettings = await listen<AppSettings>('app-settings-changed', (event) => {
        const latest = optionsRef.current;
        applyAppSettings(event.payload);
        if (latest.shouldReleaseAutoHide?.(event.payload)) {
          syncSurfaceVisible(
            latest.desiredVisibleRef,
            latest.autoHiddenRef,
            latest.setSurfaceVisible,
            undefined,
            false,
          );
        }
      });
      if (cancelled) {
        unlistenAppSettings();
      }
    })().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
      unlistenUiSettings?.();
      unlistenAppSettings?.();
    };
  }, []);
}
