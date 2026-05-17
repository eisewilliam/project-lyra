import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './settings.css';

const isWindows = navigator.userAgent.includes('Windows');

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
type Section = 'general' | 'main' | 'island' | 'karaoke';

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
  island_show_cover: boolean;
  island_cover_circle: boolean;
  island_cover_spin: boolean;
  island_show_on_fullscreen: boolean;
  karaoke_show_on_fullscreen: boolean;
  floating_show_on_fullscreen: boolean;
  theme: string;
  karaoke_position: string;
  karaoke_alignment: string;
  karaoke_width_pct: number;
  karaoke_offset_px: number;
  karaoke_lines: number;
  karaoke_bg_opacity: number;
  karaoke_bold: boolean;
};

type AppSettings = {
  window: { click_through: boolean; hide_when_idle: boolean; always_on_top: boolean };
  appearance: { font_family: string; font_size: number; text_color: string; background_opacity: number; context_lines_above: number; context_lines_below: number };
  behavior: { karaoke_mode: boolean; poll_interval_ms: number; hide_when_paused: boolean };
};

type ConsolidatedState = { ui: UiState; app: AppSettings };

type NavItem = { id: Section; label: string; icon: ReactNode; color: string };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [{ id: 'general', label: 'General', icon: <IconGear />, color: '#8e8e93' }],
  },
  {
    header: 'Surfaces',
    items: [
      { id: 'main', label: 'Lyra', icon: <IconWindow />, color: '#0A84FF' },
      { id: 'island', label: 'Dynamic Island', icon: <IconIsland />, color: '#34c759' },
      { id: 'karaoke', label: 'Karaoke', icon: <IconKaraoke />, color: '#ff453a' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function Settings() {
  const [state, setState] = useState<ConsolidatedState | null>(null);
  const [section, setSection] = useState<Section>('general');
  const debounceRef = useRef<Record<string, number>>({});

  useEffect(() => {
    document.body.dataset.os = isWindows ? 'windows' : 'macos';

    let unlisten: (() => void) | undefined;
    (async () => {
      const [ui, app] = await Promise.all([
        invoke<UiState>('get_ui_state'),
        invoke<AppSettings>('get_settings'),
      ]);
      setState({ ui, app });
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        setState((prev) => prev ? { ...prev, ui: { ...prev.ui, ...e.payload } } : null);
      });
    })();
    return () => unlisten?.();
  }, []);

  const patchUi = (changes: Partial<UiState>) => {
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
      patchUi({ [key]: !state?.ui[key] } as Partial<UiState>);
      invoke('toggle_surface', { label: surface });
    },
    setFullscreen: (surface: Surface, value: boolean) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_show_on_fullscreen',
        island: 'island_show_on_fullscreen',
        karaoke: 'karaoke_show_on_fullscreen',
      };
      patchUi({ [map[surface]]: value } as Partial<UiState>);
      invoke('set_show_on_fullscreen', { surface, value });
    },
    setLock: (locked: boolean) => {
      patchUi({ island_locked: locked });
      invoke('set_island_locked', { locked });
    },
    setIslandSize: (width: number, height: number) => {
      patchUi({ island_width: width, island_height: height });
      debounced('island-size', 120, () => {
        invoke('set_island_size', { width, height });
      });
    },
    resetIslandPosition: () => {
      patchUi({ island_pos: null });
      invoke('save_island_position', { x: -1, y: -1 });
    },
    setFont: (surface: Surface, scale: number) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_font_scale',
        island: 'island_font_scale',
        karaoke: 'karaoke_font_scale',
      };
      patchUi({ [map[surface]]: scale } as Partial<UiState>);
      debounced(`font-${surface}`, 80, () => {
        invoke('set_font_scale', { surface, scale });
      });
    },
    island: (key: keyof UiState, value: unknown) => {
      patchUi({ [key]: value } as Partial<UiState>);
      const payload = {
        show_cover: undefined,
        cover_circle: undefined,
        cover_spin: undefined,
      } as Record<string, unknown>;
      const fieldMap: Record<string, string> = {
        island_show_cover: 'show_cover',
        island_cover_circle: 'cover_circle',
        island_cover_spin: 'cover_spin',
      };
      const field = fieldMap[key as string];
      if (!field) return;
      payload[field] = value;
      invoke('update_island_settings', { patch: payload });
    },
    setTheme: (theme: string) => {
      patchUi({ theme });
      invoke('set_theme', { theme });
    },
    updateAppSetting: (category: keyof AppSettings, key: string, value: unknown, dbKey?: string) => {
      if (!state) return;
      const patch = { [category]: { ...state.app[category], [key]: value } as Record<string, unknown> };
      patchApp(patch);
      const send = () => invoke('update_settings', { patch });
      if (dbKey) debounced(dbKey, 150, send);
      else send();
    },
    karaoke: (key: keyof UiState, value: unknown, dbKey?: string) => {
      patchUi({ [key]: value } as Partial<UiState>);
      const payload = {
        position: undefined,
        alignment: undefined,
        width_pct: undefined,
        offset_px: undefined,
        lines: undefined,
        bg_opacity: undefined,
        bold: undefined,
      } as Record<string, unknown>;
      const fieldMap: Record<string, string> = {
        karaoke_position: 'position',
        karaoke_alignment: 'alignment',
        karaoke_width_pct: 'width_pct',
        karaoke_offset_px: 'offset_px',
        karaoke_lines: 'lines',
        karaoke_bg_opacity: 'bg_opacity',
        karaoke_bold: 'bold',
      };
      const field = fieldMap[key as string];
      if (!field) return;
      payload[field] = value;
      const send = () => invoke('update_karaoke_settings', { patch: payload });
      if (dbKey) debounced(dbKey, 80, send);
      else send();
    },
  };

  const active = ALL_ITEMS.find((n) => n.id === section);

  return (
    <div className="settings-shell">
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
            <Body section={section} state={state} actions={actions} activeLabel={active?.label} />
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
};

function Body({
  section,
  state,
  actions,
  activeLabel,
}: {
  section: Section;
  state: ConsolidatedState;
  actions: Actions;
  activeLabel: string | undefined;
}) {
  const { ui, app } = state;
  if (section === 'general') {
    return (
      <>
        <Group title="System">
          <Row label="Theme">
            <select value={ui.theme} onChange={(e) => actions.setTheme(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Row>
          <Row label="Polling interval">
            <select
              value={String(app.behavior.poll_interval_ms)}
              onChange={(e) =>
                actions.updateAppSetting('behavior', 'poll_interval_ms', parseInt(e.target.value, 10))
              }
            >
              <option value="250">Very Fast (250ms)</option>
              <option value="500">Fast (500ms)</option>
              <option value="1000">Normal (1s)</option>
              <option value="2000">Slow (2s)</option>
            </select>
          </Row>
          <Row label="Hide all displays when paused">
            <Toggle value={app.behavior.hide_when_paused} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'hide_when_paused', v)} />
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
                { value: 0, label: '0px' },
                { value: 24, label: '24px' },
                { value: 48, label: '48px' },
                { value: 72, label: '72px' },
                { value: 96, label: '96px' },
                { value: 120, label: '120px' },
              ]}
              value={ui.karaoke_offset_px}
              onChange={(v) => actions.karaoke('karaoke_offset_px', v, 'k-offset')}
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
        </>
      ),
      extraLayout: (
        <>
          <Row label="Font face">
            <select
              value={app.appearance.font_family}
              onChange={(e) =>
                actions.updateAppSetting('appearance', 'font_family', e.target.value)
              }
            >
              <option value="system-ui">System Default</option>
              <option value="'SF Pro Rounded', sans-serif">SF Pro Rounded</option>
              <option value="'Inter', sans-serif">Inter</option>
              <option value="monospace">Monospace</option>
            </select>
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
            />
          </Row>
          <Row label="Buffer lines above">
            <select
              value={String(app.appearance.context_lines_above)}
              onChange={(e) =>
                actions.updateAppSetting('appearance', 'context_lines_above', parseInt(e.target.value, 10))
              }
            >
              <option value="1">1 Line</option>
              <option value="2">2 Lines</option>
              <option value="3">3 Lines</option>
              <option value="4">4 Lines</option>
              <option value="5">5 Lines</option>
            </select>
          </Row>
          <Row label="Buffer lines below">
            <select
              value={String(app.appearance.context_lines_below)}
              onChange={(e) =>
                actions.updateAppSetting('appearance', 'context_lines_below', parseInt(e.target.value, 10))
              }
            >
              <option value="1">1 Line</option>
              <option value="2">2 Lines</option>
              <option value="3">3 Lines</option>
              <option value="4">4 Lines</option>
              <option value="5">5 Lines</option>
            </select>
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
                { value: 400, label: '400' },
                { value: 500, label: '500' },
                { value: 600, label: '600' },
                { value: 700, label: '700' },
                { value: 800, label: '800' },
                { value: 900, label: '900' },
              ]}
              value={ui.island_width ?? 600}
              onChange={(v) => actions.setIslandSize(v, ui.island_height ?? 72)}
            />
          </Row>
          <Row label="Overlay height">
            <SnapSlider
              steps={[
                { value: 52, label: '52' },
                { value: 64, label: '64' },
                { value: 72, label: '72' },
                { value: 88, label: '88' },
                { value: 104, label: '104' },
              ]}
              value={ui.island_height ?? 72}
              onChange={(v) => actions.setIslandSize(ui.island_width ?? 600, v)}
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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="native-toggle"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      // @ts-expect-error - specific hack
      switch="true"
    />
  );
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
  return (
    <div className="segmented">
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

function SnapSlider({
  steps,
  value,
  onChange,
}: {
  steps: Array<{ value: number; label: string }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const idx = steps.reduce(
    (best, s, i) =>
      Math.abs(s.value - value) < Math.abs(steps[best].value - value) ? i : best,
    0
  );
  return (
    <div className="snap-slider">
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={idx}
        onChange={(e) => onChange(steps[parseInt(e.target.value, 10)].value)}
      />
      <div className="snap-slider-labels">
        {steps.map((s, i) => (
          <span key={i} className={`snap-label${i === idx ? ' active' : ''}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
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
