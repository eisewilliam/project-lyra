import { useEffect, useId, useLayoutEffect, useRef, useState, memo, type FormEvent, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { applyHostOsDataset, detectHostOs } from '@/utils/os';
import type {
  AppSettings,
  IslandSettingsPatch,
  KaraokeSettingsPatch,
  MonitorInfo,
  RenderSnapshot,
  SettingsPatch,
  UiState,
  UiStatePatch,
} from '@/types/tauri-contracts';
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
  setIslandLocked,
  setIslandSize,
  setPreferredMonitor,
  setShowOnFullscreen,
  setTheme,
  toggleSurface,
  updateIslandSettings,
  updateKaraokeSettings,
  updateSettings,
} from '@/utils/tauri-commands';
import './settings.css';

const isWindows = detectHostOs() === 'windows';

function SettingsWinControls() {
  const win = getCurrentWindow();
  return (
    <div className="settings-win-controls">
      <button className="settings-win-btn" onClick={() => win.minimize()} aria-label="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
      </button>
      <button className="settings-win-btn close" onClick={() => win.close()} aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
      </button>
    </div>
  );
}

type Surface = 'main' | 'island' | 'karaoke';
type Section = 'general' | 'appearance' | 'main' | 'island' | 'karaoke';

type ConsolidatedState = { ui: UiState; app: AppSettings };

type NavItem = { id: Section; label: string; icon: ReactNode; color: string };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [
      { id: 'general', label: 'General', icon: <IconGear />, color: '#8e8e93' },
      { id: 'appearance', label: 'Appearance', icon: <IconAppearance />, color: '#ff9500' },
    ],
  },
  {
    header: 'Surfaces',
    items: [
      { id: 'main', label: 'Main Window', icon: <IconWindow />, color: '#0A84FF' },
      { id: 'island', label: 'Dynamic Island', icon: <IconIsland />, color: '#34c759' },
      { id: 'karaoke', label: 'Karaoke', icon: <IconKaraoke />, color: '#ff453a' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function Settings() {
  const [state, setState] = useState<ConsolidatedState | null>(null);
  const [section, setSection] = useState<Section>('general');
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const debounceRef = useRef<Record<string, number>>({});
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
      setState({ ui, app });
      setAutostartEnabled(autostart);
      setMonitors(monitorList);
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        setState((prev) => prev ? { ...prev, ui: { ...prev.ui, ...e.payload } } : null);
      });
    })();
    return () => unlisten?.();
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
    setState((prev) => (prev ? { ...prev, ui: { ...prev.ui, ...changes } } : prev));
  };

  const patchApp = (changes: Partial<AppSettings>) => {
    setState((prev) => {
      if (!prev) return prev;
      const nextApp = {
        window: { ...prev.app.window, ...(changes.window || {}) },
        appearance: { ...prev.app.appearance, ...(changes.appearance || {}) },
        behavior: { ...prev.app.behavior, ...(changes.behavior || {}) },
      };
      return { ...prev, app: nextApp };
    });
  };

  const debounced = (key: string, ms: number, fn: () => void) => {
    const timers = debounceRef.current;
    if (timers[key]) window.clearTimeout(timers[key]);
    timers[key] = window.setTimeout(fn, ms);
  };

  const actions = {
    toggleVisible: (surface: Surface) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_visible',
        island: 'island_visible',
        karaoke: 'karaoke_visible',
      };
      const key = map[surface];
      patchUi({ [key]: !state?.ui[key] } as UiStatePatch);
      toggleSurface(surface);
    },
    setFullscreen: (surface: Surface, value: boolean) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_show_on_fullscreen',
        island: 'island_show_on_fullscreen',
        karaoke: 'karaoke_show_on_fullscreen',
      };
      patchUi({ [map[surface]]: value } as UiStatePatch);
      setShowOnFullscreen(surface, value);
    },
    setLock: (locked: boolean) => {
      patchUi({ island_locked: locked });
      setIslandLocked(locked);
    },
    setIslandSize: (width: number, height: number) => {
      patchUi({ island_width: width, island_height: height });
      debounced('island-size', 120, () => {
        setIslandSize(width, height);
      });
    },
    resetIslandPosition: () => {
      patchUi({ island_pos: null });
      saveIslandPosition(-1, -1);
    },
    setFont: (surface: Surface, scale: number) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_font_scale',
        island: 'island_font_scale',
        karaoke: 'karaoke_font_scale',
      };
      patchUi({ [map[surface]]: scale } as UiStatePatch);
      debounced(`font-${surface}`, 80, () => {
        setFontScale(surface, scale);
      });
    },
    island: (key: keyof UiState, value: unknown) => {
      patchUi({ [key]: value } as UiStatePatch);
      const payload: IslandSettingsPatch = {};
      const fieldMap: Partial<Record<keyof UiState, keyof IslandSettingsPatch>> = {
        island_show_cover: 'show_cover',
        island_cover_circle: 'cover_circle',
        island_cover_spin: 'cover_spin',
      };
      const field = fieldMap[key];
      if (!field) return;
      payload[field] = Boolean(value);
      updateIslandSettings(payload);
    },
    setTheme: (theme: string) => {
      patchUi({ theme });
      setTheme(theme);
    },
    updateAppSetting: (category: keyof AppSettings, key: string, value: unknown, dbKey?: string) => {
      if (!state) return;
      const patch = { [category]: { ...state.app[category], [key]: value } } as SettingsPatch;
      patchApp(patch);
      const send = () => updateSettings(patch);
      if (dbKey) debounced(dbKey, 150, send);
      else send();
    },
    karaoke: (key: keyof UiState, value: unknown, dbKey?: string) => {
      patchUi({ [key]: value } as UiStatePatch);
      const payload: KaraokeSettingsPatch = {};
      const fieldMap: Partial<Record<keyof UiState, keyof KaraokeSettingsPatch>> = {
        karaoke_position: 'position',
        karaoke_alignment: 'alignment',
        karaoke_width_pct: 'width_pct',
        karaoke_offset_px: 'offset_px',
        karaoke_lines: 'lines',
        karaoke_bg_opacity: 'bg_opacity',
        karaoke_bold: 'bold',
      };
      const field = fieldMap[key];
      if (!field) return;
      Object.assign(payload, { [field]: value });
      const send = () => updateKaraokeSettings(payload);
      if (dbKey) debounced(dbKey, 80, send);
      else send();
    },
    setAutostart: (enabled: boolean) => {
      setAutostartEnabled(enabled);
      setAutostart(enabled).catch(() => setAutostartEnabled(!enabled));
    },
    clearCache: async () => {
      try {
        await clearLyricsCache();
      } catch (err) {
        console.error('Failed to clear cache', err);
      }
    },
    setPreferredMonitor: (name: string | null) => {
      patchUi({ preferred_monitor: name });
      setPreferredMonitor(name);
    },
  };

  const active = ALL_ITEMS.find((n) => n.id === section);

  const artworkSrcUrl = artworkSrc || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

  return (
    <div className="settings-shell">
      {/* Glowing Ambient Background (Color Bounce) */}
      <div className="settings-ambient-bg" aria-hidden="true">
        <img src={artworkSrcUrl} alt="" decoding="async" key={artworkSrcUrl} />
        <div className="settings-ambient-dimmer"></div>
      </div>
      {isWindows && <SettingsWinControls />}
      <aside className="settings-sidebar">
        <div className="sidebar-traffic-spacer" data-tauri-drag-region="deep" />
        <nav>
          {NAV_GROUPS.map((group, gi) => (
            <div className="nav-group" key={gi}>
              {group.header && <div className="nav-section">{group.header}</div>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${section === item.id ? 'active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  <span className="nav-icon">
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="settings-pane">
        <header className="pane-header" data-tauri-drag-region="deep">
          <h1>{active?.label}</h1>
        </header>
        <div className="pane-body">
          {state ? (
            <Body
              section={section}
              state={state}
              actions={actions}
              activeLabel={active?.label}
              autostartEnabled={autostartEnabled}
              monitors={monitors}
            />
          ) : (
            <SettingsSkeleton />
          )}
        </div>
      </main>
    </div>
  );
}

type Actions = {
  toggleVisible: (surface: Surface) => void;
  setFullscreen: (surface: Surface, value: boolean) => void;
  setLock: (locked: boolean) => void;
  setIslandSize: (width: number, height: number) => void;
  resetIslandPosition: () => void;
  setFont: (surface: Surface, scale: number) => void;
  setTheme: (theme: string) => void;
  updateAppSetting: (category: keyof AppSettings, key: string, value: unknown, dbKey?: string) => void;
  island: (key: keyof UiState, value: unknown) => void;
  karaoke: (key: keyof UiState, value: unknown, dbKey?: string) => void;
  setAutostart: (enabled: boolean) => void;
  clearCache: () => Promise<void>;
  setPreferredMonitor: (name: string | null) => void;
};

function Body({
  section,
  state,
  actions,
  activeLabel,
  autostartEnabled,
  monitors,
}: {
  section: Section;
  state: ConsolidatedState;
  actions: Actions;
  activeLabel: string | undefined;
  autostartEnabled: boolean;
  monitors: MonitorInfo[];
}) {
  const { ui, app } = state;

  /** Human-readable label for a monitor entry. */
  function monitorLabel(m: MonitorInfo, idx: number): string {
    const res = `${m.width}×${m.height}`;
    // Windows returns device paths like "\\.\DISPLAY1" — strip the prefix for readability.
    const rawName = m.name?.replace(/^\\\\\.\\/u, '') ?? null;
    const base = rawName ? `${rawName} (${res})` : `Display ${idx + 1} (${res})`;
    return m.is_primary ? `${base} — Primary` : base;
  }

  if (section === 'general') {
    return (
      <>
        <Group title="System">
          <Row label="Theme">
            <CustomSelect
              value={ui.theme}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(val) => actions.setTheme(val)}
            />
          </Row>
          <Row label="Polling interval">
            <CustomSelect
              value={String(app.behavior.poll_interval_ms)}
              options={[
                { value: '250', label: 'Very Fast (250ms)' },
                { value: '500', label: 'Fast (500ms)' },
                { value: '1000', label: 'Normal (1s)' },
                { value: '2000', label: 'Slow (2s)' },
              ]}
              onChange={(val) => actions.updateAppSetting('behavior', 'poll_interval_ms', parseInt(val, 10))}
            />
          </Row>
          <Row label="Hide all displays when paused">
            <Toggle value={app.behavior.hide_when_paused} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'hide_when_paused', v)} />
          </Row>
        </Group>

        <Group title="Startup">
          <Row label="Launch at login">
            <Toggle value={autostartEnabled} onChange={(v: boolean) => actions.setAutostart(v)} />
          </Row>
        </Group>

        <Group title="Storage">
          <Row label="Lyrics cache">
            <ActionFeedbackButton
              label="Clear cache"
              feedbackLabel="Cleared!"
              onClick={() => actions.clearCache()}
            />
          </Row>
        </Group>

        {monitors.length > 1 && (
          <Group title="Display">
            <Row label="Show on screen">
              <CustomSelect
                value={ui.preferred_monitor ?? ''}
                options={[
                  { value: '', label: 'Primary (default)' },
                  ...monitors.map((m, i) => ({
                    value: m.name ?? '',
                    label: monitorLabel(m, i),
                  })),
                ]}
                onChange={(val) => actions.setPreferredMonitor(val === '' ? null : val)}
              />
            </Row>
          </Group>
        )}
      </>
    );
  }

  if (section === 'appearance') {
    return (
      <>
        <Group title="Typography">
          <Row label="Font face">
            <CustomSelect
              value={app.appearance.font_family}
              options={[
                { value: 'system-ui', label: 'System Default' },
                { value: "'SF Pro Rounded', sans-serif", label: 'SF Pro Rounded' },
                { value: "'Inter', sans-serif", label: 'Inter' },
                { value: 'monospace', label: 'Monospace' },
              ]}
              onChange={(val) => actions.updateAppSetting('appearance', 'font_family', val)}
            />
          </Row>
          <Row label="Base font size">
            <SnapSlider
              steps={[
                { value: 12, label: 'XS' },
                { value: 14, label: 'Small' },
                { value: 16, label: 'Medium' },
                { value: 18, label: 'Large' },
                { value: 20, label: 'XL' },
                { value: 24, label: 'XXL' },
              ]}
              value={app.appearance.font_size}
              onChange={(v) => actions.updateAppSetting('appearance', 'font_size', v, 'font-size')}
              info="Scales the base text size across the entire application interface."
            />
          </Row>
          <Row label="Primary text color">
            <input
              type="color"
              style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
              value={app.appearance.text_color || '#ffffff'}
              onChange={(e) =>
                actions.updateAppSetting('appearance', 'text_color', e.target.value, 'text-color')
              }
            />
          </Row>
        </Group>

        <Group title="Color & Dimming">
          <Row label="Background darkness">
            <SnapSlider
              steps={[
                { value: 0, label: 'None' },
                { value: 0.25, label: '25%' },
                { value: 0.5, label: '50%' },
                { value: 0.75, label: '75%' },
                { value: 1.0, label: '100%' },
              ]}
              value={app.appearance.background_opacity}
              onChange={(v) => actions.updateAppSetting('appearance', 'background_opacity', v)}
              info="Sets the darkness level of the translucent window backdrop."
            />
          </Row>
        </Group>
      </>
    );
  }

  if (section === 'karaoke') {
    return (
      <>
        <Group title="Visibility">
          <Row label="Show Karaoke">
            <Toggle value={ui.karaoke_visible} onChange={() => actions.toggleVisible('karaoke')} />
          </Row>
          <Row label="Show over full-screen apps">
            <Toggle
              value={ui.karaoke_show_on_fullscreen}
              onChange={(v: boolean) => actions.setFullscreen('karaoke', v)}
            />
          </Row>
        </Group>

        <Group title="Layout">
          <Row label="Anchor position">
            <Segmented
              value={ui.karaoke_position}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(v: string) => actions.karaoke('karaoke_position', v)}
            />
          </Row>
          <Row label="Screen edge offset">
            <SnapSlider
              steps={[
                { value: 0, label: 'None' },
                { value: 24, label: 'Small' },
                { value: 48, label: 'Medium' },
                { value: 72, label: 'Large' },
                { value: 96, label: 'Extra' },
                { value: 120, label: 'Max' },
              ]}
              value={ui.karaoke_offset_px}
              onChange={(v) => actions.karaoke('karaoke_offset_px', v, 'k-offset')}
              info="Defines the spacing between the karaoke overlay and the edge of your screen."
            />
          </Row>
          <Row label="Line width">
            <SnapSlider
              steps={[
                { value: 50, label: '50%' },
                { value: 60, label: '60%' },
                { value: 70, label: '70%' },
                { value: 80, label: '80%' },
                { value: 90, label: '90%' },
                { value: 100, label: '100%' },
              ]}
              value={ui.karaoke_width_pct}
              onChange={(v) => actions.karaoke('karaoke_width_pct', v, 'k-width')}
              info="Sets the width of the karaoke overlay as a percentage of the screen."
            />
          </Row>
        </Group>

        <Group title="Typography & Styling">
          <Row label="Text size">
            <SnapSlider
              steps={[
                { value: 0.75, label: '75%' },
                { value: 1.0, label: 'Normal' },
                { value: 1.25, label: '125%' },
                { value: 1.5, label: '150%' },
                { value: 2.0, label: '200%' },
              ]}
              value={ui.karaoke_font_scale}
              onChange={(v) => actions.setFont('karaoke', v)}
              info="Adjusts the text size of the karaoke lyrics window."
            />
          </Row>
          <Row label="Alignment">
            <Segmented
              value={ui.karaoke_alignment}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v: string) => actions.karaoke('karaoke_alignment', v)}
            />
          </Row>
          <Row label="Displayed lines">
            <Segmented
              value={String(ui.karaoke_lines)}
              options={[
                { value: '1', label: 'Single' },
                { value: '2', label: 'Double' },
              ]}
              onChange={(v: string) => actions.karaoke('karaoke_lines', parseInt(v, 10))}
            />
          </Row>
          <Row label="Bold lyrics">
            <Toggle
              value={ui.karaoke_bold}
              onChange={(v: boolean) => actions.karaoke('karaoke_bold', v)}
            />
          </Row>
          <Row label="Background shading">
            <SnapSlider
              steps={[
                { value: 0, label: 'None' },
                { value: 0.25, label: '25%' },
                { value: 0.5, label: '50%' },
                { value: 0.75, label: '75%' },
              ]}
              value={ui.karaoke_bg_opacity}
              onChange={(v) => actions.karaoke('karaoke_bg_opacity', v, 'k-bg')}
              info="Controls the shading opacity of the karaoke overlay backdrop."
            />
          </Row>
        </Group>
      </>
    );
  }

  const surface = section as 'main' | 'island';

  const config: Record<'main' | 'island', {
    visible: boolean;
    fontScale: number;
    showFullscreen: boolean;
    extraVisibility?: ReactNode;
    extraLayout?: ReactNode;
  }> = {
    main: {
      visible: ui.floating_visible,
      fontScale: ui.floating_font_scale,
      showFullscreen: ui.floating_show_on_fullscreen,
      extraVisibility: (
        <>
          <Row label="Click-through (no interactions)">
            <Toggle value={app.window.click_through} onChange={(v: boolean) => actions.updateAppSetting('window', 'click_through', v)} />
          </Row>
          <Row label="Hide window when idle">
            <Toggle value={app.window.hide_when_idle} onChange={(v: boolean) => actions.updateAppSetting('window', 'hide_when_idle', v)} />
          </Row>
          <Row label="Keep window on top">
            <Toggle value={app.window.always_on_top} onChange={(v: boolean) => actions.updateAppSetting('window', 'always_on_top', v)} />
          </Row>
          <Row label="Karaoke-style lyrics (active line only)">
            <Toggle value={app.behavior.karaoke_mode} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'karaoke_mode', v)} />
          </Row>
        </>
      ),
      extraLayout: (
        <>
          <Row label="Buffer lines above">
            <CustomSelect
              value={String(app.appearance.context_lines_above)}
              options={[
                { value: '1', label: '1 Line' },
                { value: '2', label: '2 Lines' },
                { value: '3', label: '3 Lines' },
                { value: '4', label: '4 Lines' },
                { value: '5', label: '5 Lines' },
              ]}
              onChange={(val) => actions.updateAppSetting('appearance', 'context_lines_above', parseInt(val, 10))}
            />
          </Row>
          <Row label="Buffer lines below">
            <CustomSelect
              value={String(app.appearance.context_lines_below)}
              options={[
                { value: '1', label: '1 Line' },
                { value: '2', label: '2 Lines' },
                { value: '3', label: '3 Lines' },
                { value: '4', label: '4 Lines' },
                { value: '5', label: '5 Lines' },
              ]}
              onChange={(val) => actions.updateAppSetting('appearance', 'context_lines_below', parseInt(val, 10))}
            />
          </Row>
        </>
      )
    },
    island: {
      visible: ui.island_visible,
      fontScale: ui.island_font_scale,
      showFullscreen: ui.island_show_on_fullscreen,
      extraVisibility: (
        <>
          <Row label="Lock screen position">
            <Toggle value={ui.island_locked} onChange={(v: boolean) => actions.setLock(v)} />
          </Row>
        </>
      ),
      extraLayout: (
        <>
          <Row label="Show cover art">
            <Toggle value={ui.island_show_cover ?? true} onChange={(v: boolean) => actions.island('island_show_cover', v)} />
          </Row>
          <Row label="Circular cover art">
            <Toggle value={ui.island_cover_circle ?? false} onChange={(v: boolean) => actions.island('island_cover_circle', v)} />
          </Row>
          <Row label="Spinning cover art">
            <Toggle value={ui.island_cover_spin ?? false} onChange={(v: boolean) => actions.island('island_cover_spin', v)} />
          </Row>
          <Row label="Overlay width">
            <SnapSlider
              steps={[
                { value: 400, label: 'Narrow' },
                { value: 500, label: 'Small' },
                { value: 600, label: 'Medium' },
                { value: 700, label: 'Wide' },
                { value: 800, label: 'Wider' },
                { value: 900, label: 'Full' },
              ]}
              value={ui.island_width ?? 600}
              onChange={(v) => actions.setIslandSize(v, ui.island_height ?? 72)}
              info="Controls the width of the Dynamic Island overlay window."
            />
          </Row>
          <Row label="Overlay height">
            <SnapSlider
              steps={[
                { value: 52, label: 'Compact' },
                { value: 64, label: 'Small' },
                { value: 72, label: 'Medium' },
                { value: 88, label: 'Large' },
                { value: 104, label: 'Tall' },
              ]}
              value={ui.island_height ?? 72}
              onChange={(v) => actions.setIslandSize(ui.island_width ?? 600, v)}
              info="Controls the height of the Dynamic Island overlay window."
            />
          </Row>
          <Row label="Position">
            <button
              type="button"
              className="action-btn"
              onClick={() => actions.resetIslandPosition()}
            >
              Reset to top-center
            </button>
          </Row>
         
        </>
      ),
    },
  };

  const c = config[surface];

  return (
    <>
      <Group title="Status & Visibility">
        <Row label={`Enable ${activeLabel}`}>
          <Toggle value={c.visible} onChange={() => actions.toggleVisible(surface)} />
        </Row>
        <Row label="Show over full-screen apps">
          <Toggle value={c.showFullscreen} onChange={(v: boolean) => actions.setFullscreen(surface, v)} />
        </Row>
        {c.extraVisibility}
      </Group>

      <Group title="Layout & Appearance">
        <Row label="Font scaling">
          <SnapSlider
            steps={[
              { value: 0.75, label: '75%' },
              { value: 1.0, label: 'Normal' },
              { value: 1.25, label: '125%' },
              { value: 1.5, label: '150%' },
              { value: 2.0, label: '200%' },
            ]}
            value={c.fontScale}
            onChange={(v) => actions.setFont(surface, v)}
            info="Adjusts the size of lyrics inside this specific surface."
          />
        </Row>
        {c.extraLayout}
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="group">
      <h2 className="group-title">{title}</h2>
      <div className="group-card">{children}</div>
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div className="pane-loading" role="status" aria-live="polite" aria-label="Loading settings">
      <section className="group">
        <span className="group-title skeleton-line skeleton-title" />
        <div className="group-card">
          {[52, 44, 58].map((width, index) => (
            <div className="row skeleton-row" key={`appearance-${index}`}>
              <span className="row-label skeleton-line" style={{ width: `${width}%` }} />
              <span className="row-control skeleton-control">
                <span className="skeleton-line skeleton-pill" style={{ width: 44, height: 24, borderRadius: 24 }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <span className="group-title skeleton-line skeleton-title short" />
        <div className="group-card">
          {[60, 48].map((width, index) => (
            <div className="row skeleton-row" key={`surface-${index}`}>
              <span className="row-label skeleton-line" style={{ width: `${width}%` }} />
              <span className="row-control skeleton-control">
                <span className="skeleton-line" style={{ width: 120 }} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </div>
  );
}

const Toggle = memo(
  function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    const nativeSwitchProps = { switch: 'true' };
    return (
      <input
        {...nativeSwitchProps}
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  },
  (prevProps, nextProps) => prevProps.value === nextProps.value
);

function NativeSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function CustomSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  // const [open, setOpen] = useState(false);
  // const selected = options.find((opt) => opt.value === value) || options[0];
  return <NativeSelect value={value} options={options} onChange={onChange} />;
  // return (
  //   <div className="custom-select-container">
  //     <button
  //       type="button"
  //       className={`custom-select-trigger ${open ? 'open' : ''}`}
  //       onClick={() => setOpen(!open)}
  //     >
  //       <span>{selected.label}</span>
  //       {isWindows ? (
  //         <svg className="custom-select-arrow" width="10" height="10" viewBox="0 0 10 10">
  //           <path
  //             d="M2.5 4L5 6.5L7.5 4"
  //             stroke="currentColor"
  //             strokeWidth="1.5"
  //             strokeLinecap="round"
  //             strokeLinejoin="round"
  //             fill="none"
  //           />
  //         </svg>
  //       ) : (
  //         <svg className="custom-select-arrow" width="8" height="12" viewBox="0 0 8 12">
  //           <path
  //             d="M1.5 4.5L4 2L6.5 4.5M1.5 7.5L4 10L6.5 7.5"
  //             stroke="currentColor"
  //             strokeWidth="1.2"
  //             strokeLinecap="round"
  //             strokeLinejoin="round"
  //             fill="none"
  //           />
  //         </svg>
  //       )}
  //     </button>
  //     {open && (
  //       <>
  //         <div className="custom-select-backdrop" onClick={() => setOpen(false)} />
  //         <ul className="custom-select-dropdown" role="listbox">
  //           {options.map((opt) => (
  //             <li
  //               key={opt.value}
  //               className={`custom-select-option ${opt.value === value ? 'active' : ''}`}
  //               onClick={() => {
  //                 onChange(opt.value);
  //                 setOpen(false);
  //               }}
  //               role="option"
  //               aria-selected={opt.value === value}
  //             >
  //               {!isWindows && (
  //                 <span className="custom-select-checkmark">
  //                   {opt.value === value ? (
  //                     <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
  //                       <path
  //                         d="M2 5L4 7L8 3"
  //                         stroke="currentColor"
  //                         strokeWidth="1.5"
  //                         strokeLinecap="round"
  //                         strokeLinejoin="round"
  //                       />
  //                     </svg>
  //                   ) : null}
  //                 </span>
  //               )}
  //               <span>{opt.label}</span>
  //             </li>
  //           ))}
  //         </ul>
  //       </>
  //     )}
  //   </div>
  // );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const updateIndicator = () => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('.segmented-option.active');
    if (!activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  };

  useLayoutEffect(() => {
    updateIndicator();
  }, [value, options]);

  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, []);

  return (
    <div className="segmented" ref={containerRef}>
      {indicator && (
        <div
          className="segmented-indicator"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
          }}
        />
      )}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ActionFeedbackButton({
  label,
  feedbackLabel,
  onClick,
}: {
  label: string;
  feedbackLabel: string;
  onClick: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleClick = async () => {
    if (loading || success) return;
    setLoading(true);
    await onClick();
    setLoading(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
  };

  return (
    <button className="action-btn" type="button" onClick={handleClick} disabled={loading}>
      {success ? feedbackLabel : label}
    </button>
  );
}

function SnapSlider({
  steps,
  value,
  onChange,
}: {
  steps: Array<{ value: number; label: string }>;
  value: number;
  onChange: (v: number) => void;
  info?: string;
}) {
  const reactId = useId();
  const firstStep = steps[0];
  if (!firstStep) return null;

  const idx = steps.reduce(
    (best, s, i) => {
      const bestStep = steps[best] ?? firstStep;
      return Math.abs(s.value - value) < Math.abs(bestStep.value - value) ? i : best;
    },
    0
  );
  const listId = `snap-slider-${reactId.replace(/:/g, '')}`;
  const snappedStep = steps[idx] ?? firstStep;
  const progress = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    const nextStep = steps[Number(event.currentTarget.value)];
    if (nextStep) {
      onChange(nextStep.value);
    }
  };

  return (
    <span className="snap-slider-control">
      <span className="snap-slider-range-wrapper">
        <span className="snap-slider-range">
          <span className="snap-slider-track-container" aria-hidden="true">
            <span className="snap-slider-rail" />
            <span className="snap-slider-fill" style={{ width: `${progress}%` }} />
            <span className="snap-slider-ticks">
              {steps.map((s, i) => {
                const tickProgress = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0;
                return (
                  <span
                    key={`${s.value}-${s.label}`}
                    className={`snap-slider-tick${i === idx ? ' active' : ''}`}
                    style={{ left: `${tickProgress}%` }}
                  />
                );
              })}
            </span>
          </span>
          <input
            className="native-snap-slider"
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={idx}
            aria-valuetext={snappedStep?.label}
            title={snappedStep?.label}
            list={listId}
            onInput={handleInput}
          />
        </span>
        <span className="snap-slider-labels">
          {steps.map((s, i) => {
            const tickProgress = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0;
            return (
              <span
                key={`${s.value}-${s.label}-label`}
                className={`snap-slider-label${i === idx ? ' active' : ''}`}
                style={{ left: `${tickProgress}%` }}
              >
                {s.label}
              </span>
            );
          })}
        </span>
      </span>

      <datalist id={listId}>
        {steps.map((s, i) => (
          <option key={i} value={i} label={s.label} />
        ))}
      </datalist>
    </span>
  );
}

export function IconInfo() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="snap-slider-info-icon"
    >
      <circle cx="10" cy="10" r="8" />
      <line x1="10" y1="14" x2="10" y2="10" />
      <line x1="10" y1="6" x2="10.01" y2="6" strokeWidth="2.5" />
    </svg>
  );
}

function IconAppearance() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 3.5l5 5-10.5 10.5h-4v-4z" />
      <path d="M14 6l2.5 2.5" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-6.5 2.5c0-.4.04-.78.11-1.16L0 5.6l1.5-2.6 1.7.85a6.5 6.5 0 0 1 2-1.16L5.5 1h3l.3 1.7a6.5 6.5 0 0 1 2 1.15L12.5 3 14 5.6l-1.6 1.24c.07.38.1.76.1 1.16 0 .4-.03.78-.1 1.16L14 10.4 12.5 13l-1.7-.84a6.5 6.5 0 0 1-2 1.15L8.5 15h-3l-.3-1.7a6.5 6.5 0 0 1-2-1.15L1.5 13 0 10.4l1.6-1.24c-.07-.38-.1-.76-.1-1.16Z" />
    </svg>
  );
}

function IconWindow() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
      <line x1="2.5" y1="8" x2="17.5" y2="8" />
      <circle cx="5.5" cy="6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="6" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconIsland() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="14" height="6" rx="3" />
      <circle cx="7.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <line x1="10.5" y1="8.75" x2="14.5" y2="8.75" strokeWidth="1.25" />
      <line x1="10.5" y1="11.25" x2="13" y2="11.25" strokeWidth="1.25" />
    </svg>
  );
}

function IconKaraoke() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="11" y2="6" />
      <line x1="3" y1="10" x2="9" y2="10" />
      <line x1="3" y1="14" x2="7" y2="14" />
      <path d="M14 3.5v8.2" />
      <path d="M14 3.5l3.5 1v2l-3.5-1" />
      <circle cx="12.5" cy="13.5" r="1.8" />
    </svg>
  );
}
