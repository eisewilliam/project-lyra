import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  clearLyricsCache,
  getAutostartStatus,
  getAvailableMonitors,
  getRenderSnapshot,
  getSettings,
  getUiState,
  saveIslandPosition,
  setAutostart,
  setFontScale,
  setIslandClickThrough,
  setIslandLocked,
  setPreferredMonitor,
  setShowOnFullscreen,
  setTheme,
  toggleSurface,
  updateIslandSettings,
  updateKaraokeSettings,
  updateSettings,
} from '@/utils/tauri-commands';
import { applyHostOsDataset } from '@/utils/os';
import type { MonitorInfo, RenderSnapshot, UiState, AppSettings, SettingsPatch, UiStatePatch } from '@/types/tauri-contracts';
import {
  ISLAND_SETTINGS_FIELDS,
  KARAOKE_SETTINGS_FIELDS,
  SURFACE_FONT_SCALE_KEYS,
  SURFACE_FULLSCREEN_KEYS,
  SURFACE_VISIBILITY_KEYS,
} from '../surface-maps';
import type { Section, ConsolidatedState, FloatingSurface, Actions } from '../types';



type DebouncedTask = {
  timer: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};





export function useSettings() {
  const [state, setState] = useState<ConsolidatedState | null>(null);
  const stateRef = useRef<ConsolidatedState | null>(null);
  const [section, setSection] = useState<Section>('general');
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const autostartEnabledRef = useRef(false);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const debounceRef = useRef<Record<string, DebouncedTask>>({});
  const [artworkSrc, setArtworkSrc] = useState('');

  useEffect(() => {
    applyHostOsDataset();

    let unlisten: (() => void) | undefined;
    (async () => {
      const [ui, app, autostart, monitorList] = await Promise.all([
        getUiState(),
        getSettings(),
        getAutostartStatus().catch(() => false),
        getAvailableMonitors().catch(() => [] as MonitorInfo[]),
      ]);
      const nextState = { ui, app };
      stateRef.current = nextState;
      setState(nextState);
      autostartEnabledRef.current = autostart;
      setAutostartEnabled(autostart);
      setMonitors(monitorList);
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        const prev = stateRef.current;
        const next = prev ? { ...prev, ui: { ...prev.ui, ...e.payload } } : null;
        stateRef.current = next;
        setState(next);
      });
    })();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    return () => {
      for (const task of Object.values(debounceRef.current)) {
        globalThis.clearTimeout(task.timer);
        task.resolve();
      }
      debounceRef.current = {};
    };
  }, []);

  // The app menu's Check for Updates… opens General, where updates live.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<Section>('settings-show-section', (e) => setSection(e.payload))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlistenTick: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const initial = await getRenderSnapshot();
        if (!cancelled && initial?.playback?.track?.artwork_url) {
          setArtworkSrc(initial.playback.track.artwork_url);
        }
      } catch { /* ignored */ }
      unlistenTick = await listen<RenderSnapshot>('playback-tick', (e) => {
        if (!cancelled && e.payload?.playback?.track?.artwork_url) {
          setArtworkSrc(e.payload.playback.track.artwork_url);
        }
      });
    })();
    return () => {
      cancelled = true;
      unlistenTick?.();
    };
  }, []);

  const patchUi = (changes: UiStatePatch) => {
    const prev = stateRef.current;
    if (!prev) return;
    const next = { ...prev, ui: { ...prev.ui, ...changes } };
    stateRef.current = next;
    setState(next);
  };

  const patchApp = (changes: SettingsPatch) => {
    const prev = stateRef.current;
    if (!prev) return;
    const nextApp = {
      window: { ...prev.app.window, ...changes.window },
      appearance: { ...prev.app.appearance, ...changes.appearance },
      behavior: { ...prev.app.behavior, ...changes.behavior },
    };
    const next = { ...prev, app: nextApp };
    stateRef.current = next;
    setState(next);
  };

  const debounced = (key: string, ms: number, fn: () => Promise<void>): Promise<void> => {
    const timers = debounceRef.current;
    const existing = timers[key];
    if (existing) {
      globalThis.clearTimeout(existing.timer);
      existing.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        delete timers[key];
        fn().then(resolve, reject);
      }, ms);
      timers[key] = { timer, resolve, reject };
    });
  };

  const requireSettingsState = () => {
    const current = stateRef.current;
    if (!current) {
      throw new Error('Settings are not loaded');
    }
    return current;
  };

  const pickUiPatch = (source: UiState, keys: (keyof UiState)[]): UiStatePatch => {
    const patch: UiStatePatch = {};
    for (const key of keys) {
      Object.assign(patch, { [key]: source[key] });
    }
    return patch;
  };

  const optimisticUiAction = async (changes: UiStatePatch, command: () => Promise<void>) => {
    const previous = requireSettingsState();
    const keys = Object.keys(changes) as (keyof UiState)[];
    patchUi(changes);
    try {
      await command();
    } catch (error) {
      patchUi(pickUiPatch(previous.ui, keys));
      throw error;
    }
  };

  const appRollbackPatch = (previous: AppSettings, patch: SettingsPatch): Partial<AppSettings> => {
    const rollback: Partial<AppSettings> = {};
    if (patch.window) rollback.window = previous.window;
    if (patch.appearance) rollback.appearance = previous.appearance;
    if (patch.behavior) rollback.behavior = previous.behavior;
    return rollback;
  };

  const optimisticAppAction = async (patch: SettingsPatch, command: () => Promise<void>) => {
    const previous = requireSettingsState();
    patchApp(patch);
    try {
      await command();
    } catch (error) {
      patchApp(appRollbackPatch(previous.app, patch));
      throw error;
    }
  };

  const actions: Actions = {
    toggleVisible: async (surface: FloatingSurface | 'karaoke') => {
      const current = requireSettingsState();
      const key = SURFACE_VISIBILITY_KEYS[surface];
      await optimisticUiAction({ [key]: !current.ui[key] }, () => toggleSurface(surface));
    },
    setFullscreen: async (surface: FloatingSurface | 'karaoke', value: boolean) => {
      await optimisticUiAction(
        { [SURFACE_FULLSCREEN_KEYS[surface]]: value },
        () => setShowOnFullscreen(surface, value),
      );
    },
    setLock: async (locked: boolean) => {
      await optimisticUiAction({ island_locked: locked }, () => setIslandLocked(locked));
    },
    setIslandClickThrough: async (enabled: boolean) => {
      await optimisticUiAction(
        { island_click_through: enabled },
        () => setIslandClickThrough(enabled),
      );
    },
    setIslandSize: async (scale: number | null) => {
      await optimisticUiAction(
        { island_scale: scale },
        () => updateIslandSettings(scale === null ? { match_screen: true } : { scale }),
      );
    },
    resetIslandPosition: async () => {
      await optimisticUiAction({ island_pos: null }, () => saveIslandPosition(-1, -1));
    },
    setFont: async (surface: FloatingSurface | 'karaoke', scale: number) => {
      await optimisticUiAction(
        { [SURFACE_FONT_SCALE_KEYS[surface]]: scale },
        () => debounced(`font-${surface}`, 80, () => setFontScale(surface, scale)),
      );
    },
    island: async (key: keyof UiState, value: unknown, dbKey?: string) => {
      const payload = {};
      const field = ISLAND_SETTINGS_FIELDS[key];
      if (!field) return;
      Object.assign(payload, { [field]: typeof value === 'number' ? value : Boolean(value) });
      const send = () => updateIslandSettings(payload);
      await optimisticUiAction(
        { [key]: value },
        () => (dbKey ? debounced(dbKey, 80, send) : send()),
      );
    },
    setTheme: async (theme: string) => {
      await optimisticUiAction({ theme }, () => setTheme(theme));
    },
    updateAppSetting: async (category: keyof AppSettings, key: string, value: unknown, dbKey?: string) => {
      const current = requireSettingsState();
      const patch = { [category]: { ...current.app[category], [key]: value } } as SettingsPatch;
      const send = () => updateSettings(patch);
      await optimisticAppAction(
        patch,
        () => (dbKey ? debounced(dbKey, 150, send) : send()),
      );
    },
    karaoke: async (key: keyof UiState, value: unknown, dbKey?: string) => {
      const payload = {};
      const field = KARAOKE_SETTINGS_FIELDS[key];
      if (!field) return;
      Object.assign(payload, { [field]: value });
      const send = () => updateKaraokeSettings(payload);
      await optimisticUiAction(
        { [key]: value },
        () => (dbKey ? debounced(dbKey, 80, send) : send()),
      );
    },
    setAutostart: async (enabled: boolean) => {
      const previous = autostartEnabledRef.current;
      autostartEnabledRef.current = enabled;
      setAutostartEnabled(enabled);
      try {
        await setAutostart(enabled);
      } catch (error) {
        autostartEnabledRef.current = previous;
        setAutostartEnabled(previous);
        throw error;
      }
    },
    clearCache: async () => {
      await clearLyricsCache();
    },
    setPreferredMonitor: async (name: string | null) => {
      await optimisticUiAction({ preferred_monitor: name }, () => setPreferredMonitor(name));
    },
  };

  return {
    state,
    section,
    setSection,
    autostartEnabled,
    monitors,
    artworkSrc,
    actions,
  };
}
