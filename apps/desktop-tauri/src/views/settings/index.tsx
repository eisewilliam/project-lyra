import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './settings.css';

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

type NavItem = { id: Section; label: string; icon: ReactNode; color: string };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [{ id: 'general', label: 'General', icon: <IconGear />, color: '#8e8e93' }],
  },
  {
    header: 'Surfaces',
    items: [
      { id: 'main', label: 'Lyra', icon: <IconWindow />, color: '#5e8aff' },
      { id: 'island', label: 'Dynamic Island', icon: <IconIsland />, color: '#34c759' },
      { id: 'karaoke', label: 'Karaoke', icon: <IconKaraoke />, color: '#ff453a' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function Settings() {
  const [state, setState] = useState<UiState | null>(null);
  const [section, setSection] = useState<Section>('general');
  const debounceRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const s = await invoke<UiState>('get_ui_state');
      setState(s);
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        setState((prev) => ({ ...(prev ?? e.payload), ...e.payload }));
      });
    })();
    return () => unlisten?.();
  }, []);

  const patch = (changes: Partial<UiState>) => {
    setState((prev) => (prev ? { ...prev, ...changes } : prev));
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
      patch({ [key]: !state?.[key] } as Partial<UiState>);
      invoke('toggle_surface', { label: surface });
    },
    setFullscreen: (surface: Surface, value: boolean) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_show_on_fullscreen',
        island: 'island_show_on_fullscreen',
        karaoke: 'karaoke_show_on_fullscreen',
      };
      patch({ [map[surface]]: value } as Partial<UiState>);
      invoke('set_show_on_fullscreen', { surface, value });
    },
    setLock: (locked: boolean) => {
      patch({ island_locked: locked });
      invoke('set_island_locked', { locked });
    },
    setIslandSize: (width: number, height: number) => {
      patch({ island_width: width, island_height: height });
      debounced('island-size', 120, () => {
        invoke('set_island_size', { width, height });
      });
    },
    resetIslandPosition: () => {
      patch({ island_pos: null });
      invoke('save_island_position', { x: -1, y: -1 });
    },
    setFont: (surface: Surface, scale: number) => {
      const map: Record<Surface, keyof UiState> = {
        main: 'floating_font_scale',
        island: 'island_font_scale',
        karaoke: 'karaoke_font_scale',
      };
      patch({ [map[surface]]: scale } as Partial<UiState>);
      debounced(`font-${surface}`, 80, () => {
        invoke('set_font_scale', { surface, scale });
      });
    },
    setTheme: (theme: string) => {
      patch({ theme });
      invoke('set_theme', { theme });
    },
    karaoke: (key: keyof UiState, value: unknown, dbKey?: string) => {
      patch({ [key]: value } as Partial<UiState>);
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
                  <span className="nav-icon" style={{ color: item.color }}>
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
            <Body section={section} state={state} actions={actions} />
          ) : (
            <SettingsSkeleton />
          )}
        </div>
      </main>
    </div>
  );
}

type Actions = {
  toggleVisible: (s: Surface) => void;
  setFullscreen: (s: Surface, v: boolean) => void;
  setLock: (v: boolean) => void;
  setIslandSize: (w: number, h: number) => void;
  resetIslandPosition: () => void;
  setFont: (s: Surface, v: number) => void;
  setTheme: (t: string) => void;
  karaoke: (k: keyof UiState, v: unknown, dbKey?: string) => void;
};

function Body({
  section,
  state,
  actions,
}: {
  section: Section;
  state: UiState;
  actions: Actions;
}) {
  if (section === 'general') {
    return (
      <Group title="Appearance">
        <Row label="Theme">
          <select value={state.theme} onChange={(e) => actions.setTheme(e.target.value)}>
            <option value="auto">Auto</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Row>
      </Group>
    );
  }

  if (section === 'karaoke') {
    return (
      <>
        <Group title="Visibility">
          <Row label="Show">
            <Toggle value={state.karaoke_visible} onChange={() => actions.toggleVisible('karaoke')} />
          </Row>
          <Row label="Show in fullscreen">
            <Toggle
              value={state.karaoke_show_on_fullscreen}
              onChange={(v) => actions.setFullscreen('karaoke', v)}
            />
          </Row>
        </Group>

        <Group title="Position">
          <Row label="Anchor">
            <Segmented
              value={state.karaoke_position}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(v) => actions.karaoke('karaoke_position', v)}
            />
          </Row>
          <Row label={`Edge offset (${state.karaoke_offset_px}px)`}>
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={state.karaoke_offset_px}
              onChange={(e) =>
                actions.karaoke('karaoke_offset_px', parseInt(e.target.value, 10), 'k-offset')
              }
            />
          </Row>
          <Row label={`Width (${state.karaoke_width_pct}%)`}>
            <input
              type="range"
              min={30}
              max={100}
              step={1}
              value={state.karaoke_width_pct}
              onChange={(e) =>
                actions.karaoke('karaoke_width_pct', parseInt(e.target.value, 10), 'k-width')
              }
            />
          </Row>
        </Group>

        <Group title="Appearance">
          <Row label={`Font size (${Math.round(state.karaoke_font_scale * 100)}%)`}>
            <input
              type="range"
              min={0.6}
              max={2.0}
              step={0.05}
              value={state.karaoke_font_scale}
              onChange={(e) => actions.setFont('karaoke', parseFloat(e.target.value))}
            />
          </Row>
          <Row label="Alignment">
            <Segmented
              value={state.karaoke_alignment}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => actions.karaoke('karaoke_alignment', v)}
            />
          </Row>
          <Row label="Lines">
            <Segmented
              value={String(state.karaoke_lines)}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
              ]}
              onChange={(v) => actions.karaoke('karaoke_lines', parseInt(v, 10))}
            />
          </Row>
          <Row label="Bold text">
            <Toggle
              value={state.karaoke_bold}
              onChange={(v) => actions.karaoke('karaoke_bold', v)}
            />
          </Row>
          <Row label={`Background opacity (${Math.round(state.karaoke_bg_opacity * 100)}%)`}>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={state.karaoke_bg_opacity}
              onChange={(e) =>
                actions.karaoke('karaoke_bg_opacity', parseFloat(e.target.value), 'k-bg')
              }
            />
          </Row>
        </Group>
      </>
    );
  }

  const config: Record<'main' | 'island', {
    visible: boolean;
    fontScale: number;
    showFullscreen: boolean;
    extra?: ReactNode;
    sizeSection?: ReactNode;
  }> = {
    main: {
      visible: state.floating_visible,
      fontScale: state.floating_font_scale,
      showFullscreen: state.floating_show_on_fullscreen,
    },
    island: {
      visible: state.island_visible,
      fontScale: state.island_font_scale,
      showFullscreen: state.island_show_on_fullscreen,
      extra: (
        <>
          <Row label="Lock position">
            <Toggle value={state.island_locked} onChange={(v) => actions.setLock(v)} />
          </Row>
        </>
      ),
      sizeSection: (
        <Group title="Size">
          <Row label={`Width (${state.island_width ?? 600}px)`}>
            <input
              type="range"
              min={300}
              max={1000}
              step={10}
              value={state.island_width ?? 600}
              onChange={(e) =>
                actions.setIslandSize(parseInt(e.target.value, 10), state.island_height ?? 72)
              }
            />
          </Row>
          <Row label={`Height (${state.island_height ?? 72}px)`}>
            <input
              type="range"
              min={48}
              max={200}
              step={2}
              value={state.island_height ?? 72}
              onChange={(e) =>
                actions.setIslandSize(state.island_width ?? 600, parseInt(e.target.value, 10))
              }
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
        </Group>
      ),
    },
  };

  const surface = section as 'main' | 'island';
  const c = config[surface];

  return (
    <>
      <Group title="Visibility">
        <Row label="Show">
          <Toggle value={c.visible} onChange={() => actions.toggleVisible(surface)} />
        </Row>
        <Row label="Show in fullscreen">
          <Toggle value={c.showFullscreen} onChange={(v) => actions.setFullscreen(surface, v)} />
        </Row>
        {c.extra}
      </Group>

      <Group title="Appearance">
        <Row label={`Lyrics font size (${Math.round(c.fontScale * 100)}%)`}>
          <input
            type="range"
            min={0.6}
            max={2.0}
            step={0.05}
            value={c.fontScale}
            onChange={(e) => actions.setFont(surface, parseFloat(e.target.value))}
          />
        </Row>
      </Group>

      {c.sizeSection}
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
                <span className="skeleton-line skeleton-pill" />
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
                <span className={`skeleton-line ${index === 0 ? 'skeleton-toggle' : 'skeleton-slider'}`} />
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
      // @ts-expect-error - `switch` is a non-standard WebKit attribute
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

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-6.5 2.5c0-.4.04-.78.11-1.16L0 5.6l1.5-2.6 1.7.85a6.5 6.5 0 0 1 2-1.16L5.5 1h3l.3 1.7a6.5 6.5 0 0 1 2 1.15L12.5 3 14 5.6l-1.6 1.24c.07.38.1.76.1 1.16 0 .4-.03.78-.1 1.16L14 10.4 12.5 13l-1.7-.84a6.5 6.5 0 0 1-2 1.15L8.5 15h-3l-.3-1.7a6.5 6.5 0 0 1-2-1.15L1.5 13 0 10.4l1.6-1.24c-.07-.38-.1-.76-.1-1.16Z" />
    </svg>
  );
}

function IconWindow() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      <rect x="1.5" y="3" width="13" height="3" rx="2" fillOpacity="0.4" />
    </svg>
  );
}

function IconIsland() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
      <rect x="2" y="5" width="12" height="6" rx="3" />
    </svg>
  );
}

function IconKaraoke() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
      <path d="M11 2v7.2a2.4 2.4 0 1 0 1.2 2.1V4.5l2-.5V2.5L11 2Z" />
      <path d="M2 5h6v1.5H2zM2 8h5v1.5H2zM2 11h3v1.5H2z" opacity="0.6" />
    </svg>
  );
}
