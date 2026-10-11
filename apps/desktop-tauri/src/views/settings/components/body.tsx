import type { ReactNode } from 'react';
import {
  ActionFeedbackButton,
  CustomSelect,
  Group,
  Row,
  Segmented,
  SnapSlider,
  Toggle,
} from '@/components/settings-controls';
import type { MonitorInfo } from '@/types/tauri-contracts';
import { runSettingsAction } from '@/utils/settings-action-runner';
import {
  BACKGROUND_OPACITY_STEPS,
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_STEPS,
  FONT_SIZE_STEPS,
  ISLAND_HEIGHT_STEPS,
  ISLAND_WIDTH_STEPS,
  KARAOKE_ALIGNMENT_OPTIONS,
  KARAOKE_BACKGROUND_STEPS,
  KARAOKE_LINE_OPTIONS,
  KARAOKE_OFFSET_STEPS,
  KARAOKE_POSITION_OPTIONS,
  KARAOKE_WIDTH_STEPS,
  MAIN_CONTEXT_LINE_OPTIONS,
  POLLING_INTERVAL_OPTIONS,
  THEME_OPTIONS,
} from '../settings-options';
import type { FloatingSurface, SettingsBodyProps } from '../types';
import { PlayersSection } from './players-section';

function monitorLabel(m: MonitorInfo, idx: number): string {
  const res = `${m.width}×${m.height}`;
  const rawName = m.name?.replace(/^\\\\\.\\/u, '') ?? null;
  const base = rawName ? `${rawName} (${res})` : `Display ${idx + 1} (${res})`;
  return m.is_primary ? `${base} — Primary` : base;
}

export function Body({
  section,
  state,
  actions,
  activeLabel,
  autostartEnabled,
  monitors,
}: Readonly<SettingsBodyProps>) {
  const { ui, app } = state;

  if (section === 'general') {
    return (
      <>
        <Group title="System">
          <Row label="Theme">
            <CustomSelect
              value={ui.theme}
              options={THEME_OPTIONS}
              onChange={(val) => actions.setTheme(val)}
            />
          </Row>
          <Row label="Polling interval">
            <CustomSelect
              value={String(app.behavior.poll_interval_ms)}
              options={POLLING_INTERVAL_OPTIONS}
              onChange={(val) => actions.updateAppSetting('behavior', 'poll_interval_ms', Number.parseInt(val, 10))}
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
              pendingLabel="Clearing..."
              feedbackLabel="Cleared!"
              failureLabel="Failed"
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

  if (section === 'players') {
    return (
      <PlayersSection
        browserLyrics={app.behavior.browser_lyrics}
        onBrowserLyricsChange={(choice) => actions.updateAppSetting('behavior', 'browser_lyrics', choice)}
      />
    );
  }

  if (section === 'appearance') {
    return (
      <>
        <Group title="Typography">
          <Row label="Font face">
            <CustomSelect
              value={app.appearance.font_family}
              options={FONT_FAMILY_OPTIONS}
              onChange={(val) => actions.updateAppSetting('appearance', 'font_family', val)}
            />
          </Row>
          <Row label="Base font size">
            <SnapSlider
              steps={FONT_SIZE_STEPS}
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
              steps={BACKGROUND_OPACITY_STEPS}
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
              options={KARAOKE_POSITION_OPTIONS}
              onChange={(v: string) => actions.karaoke('karaoke_position', v)}
            />
          </Row>
          <Row label="Screen edge offset">
            <SnapSlider
              steps={KARAOKE_OFFSET_STEPS}
              value={ui.karaoke_offset_px}
              onChange={(v) => actions.karaoke('karaoke_offset_px', v, 'k-offset')}
              info="Defines the spacing between the karaoke overlay and the edge of your screen."
            />
          </Row>
          <Row label="Line width">
            <SnapSlider
              steps={KARAOKE_WIDTH_STEPS}
              value={ui.karaoke_width_pct}
              onChange={(v) => actions.karaoke('karaoke_width_pct', v, 'k-width')}
              info="Sets the width of the karaoke overlay as a percentage of the screen."
            />
          </Row>
        </Group>

        <Group title="Typography & Styling">
          <Row label="Text size">
            <SnapSlider
              steps={FONT_SCALE_STEPS}
              value={ui.karaoke_font_scale}
              onChange={(v) => actions.setFont('karaoke', v)}
              info="Adjusts the text size of the karaoke lyrics window."
            />
          </Row>
          <Row label="Alignment">
            <Segmented
              value={ui.karaoke_alignment}
              options={KARAOKE_ALIGNMENT_OPTIONS}
              onChange={(v: string) => actions.karaoke('karaoke_alignment', v)}
            />
          </Row>
          <Row label="Displayed lines">
            <Segmented
              value={String(ui.karaoke_lines)}
              options={KARAOKE_LINE_OPTIONS}
              onChange={(v: string) => actions.karaoke('karaoke_lines', Number.parseInt(v, 10))}
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
              steps={KARAOKE_BACKGROUND_STEPS}
              value={ui.karaoke_bg_opacity}
              onChange={(v) => actions.karaoke('karaoke_bg_opacity', v, 'k-bg')}
              info="Controls the shading opacity of the karaoke overlay backdrop."
            />
          </Row>
        </Group>
      </>
    );
  }

  const surface = section;

  const config: Record<FloatingSurface, {
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
              options={MAIN_CONTEXT_LINE_OPTIONS}
              onChange={(val) => actions.updateAppSetting('appearance', 'context_lines_above', Number.parseInt(val, 10))}
            />
          </Row>
          <Row label="Buffer lines below">
            <CustomSelect
              value={String(app.appearance.context_lines_below)}
              options={MAIN_CONTEXT_LINE_OPTIONS}
              onChange={(val) => actions.updateAppSetting('appearance', 'context_lines_below', Number.parseInt(val, 10))}
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
        <Row label="Lock screen position">
          <Toggle value={ui.island_locked} onChange={(v: boolean) => actions.setLock(v)} />
        </Row>
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
              steps={ISLAND_WIDTH_STEPS}
              value={ui.island_width ?? 600}
              onChange={(v) => actions.setIslandSize(v, ui.island_height ?? 72)}
              info="Controls the width of the Dynamic Island overlay window."
            />
          </Row>
          <Row label="Overlay height">
            <SnapSlider
              steps={ISLAND_HEIGHT_STEPS}
              value={ui.island_height ?? 72}
              onChange={(v) => actions.setIslandSize(ui.island_width ?? 600, v)}
              info="Controls the height of the Dynamic Island overlay window."
            />
          </Row>
          <Row label="Position">
            <button
              type="button"
              className="action-btn"
              onClick={() => runSettingsAction(actions.resetIslandPosition())}
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
            steps={FONT_SCALE_STEPS}
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
