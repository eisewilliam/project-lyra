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
  LYRIC_BLUR_STEPS,
  THEME_OPTIONS,
} from '../settings-options';
import type { FloatingSurface, SettingsBodyProps } from '../types';
import { PlayersSection } from './players-section';
import { AppearancePreview, IslandPreview, KaraokePreview } from './previews';

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
  artworkSrc,
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
          <Row label="Battery saver" hint="Checks the player once a second and lightens blur effects.">
            <Toggle value={app.behavior.battery_saver} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'battery_saver', v)} />
          </Row>
          <Row label="Hide when paused" hint="Hides every Lyra window while playback is paused.">
            <Toggle value={app.behavior.hide_when_paused} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'hide_when_paused', v)} />
          </Row>
        </Group>

        <Group title="Startup">
          <Row label="Launch at login">
            <Toggle value={autostartEnabled} onChange={(v: boolean) => actions.setAutostart(v)} />
          </Row>
        </Group>

        <Group title="Storage">
          <Row label="Lyrics cache" hint="Cleared lyrics download again the next time each song plays.">
            <ActionFeedbackButton
              label="Clear cache"
              pendingLabel="Clearing…"
              feedbackLabel="Cleared"
              failureLabel="Couldn't clear"
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
        <AppearancePreview appearance={app.appearance} artworkSrc={artworkSrc} />
        <Group title="Text">
          <Row label="Font face">
            <CustomSelect
              value={app.appearance.font_family}
              options={FONT_FAMILY_OPTIONS}
              onChange={(val) => actions.updateAppSetting('appearance', 'font_family', val)}
            />
          </Row>
          <Row label="Text size">
            <SnapSlider
              steps={FONT_SIZE_STEPS}
              value={app.appearance.font_size}
              onChange={(v) => actions.updateAppSetting('appearance', 'font_size', v, 'font-size')}
            />
          </Row>
          <Row label="Lyric color">
            <input
              type="color"
              className="color-well"
              value={app.appearance.text_color || '#ffffff'}
              onChange={(e) =>
                actions.updateAppSetting('appearance', 'text_color', e.target.value, 'text-color')
              }
            />
          </Row>
        </Group>

        <Group title="Background">
          <Row label="Background darkness" hint="Main window and Dynamic Island.">
            <SnapSlider
              steps={BACKGROUND_OPACITY_STEPS}
              value={app.appearance.background_opacity}
              onChange={(v) => actions.updateAppSetting('appearance', 'background_opacity', v)}
            />
          </Row>
          <Row label="Lyric blur" hint="Softens the lines around the current one.">
            <SnapSlider
              steps={LYRIC_BLUR_STEPS}
              value={app.appearance.lyric_blur}
              onChange={(v) => actions.updateAppSetting('appearance', 'lyric_blur', v, 'lyric-blur')}
            />
          </Row>
        </Group>
      </>
    );
  }

  if (section === 'karaoke') {
    return (
      <>
        <KaraokePreview ui={ui} appearance={app.appearance} />
        <Group title="Visibility">
          <Row label="Show Karaoke Lyrics">
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
          <Row label="Position">
            <Segmented
              value={ui.karaoke_position}
              options={KARAOKE_POSITION_OPTIONS}
              onChange={(v: string) => actions.karaoke('karaoke_position', v)}
            />
          </Row>
          <Row label="Distance from edge">
            <SnapSlider
              steps={KARAOKE_OFFSET_STEPS}
              value={ui.karaoke_offset_px}
              onChange={(v) => actions.karaoke('karaoke_offset_px', v, 'k-offset')}
            />
          </Row>
          <Row label="Width">
            <SnapSlider
              steps={KARAOKE_WIDTH_STEPS}
              value={ui.karaoke_width_pct}
              onChange={(v) => actions.karaoke('karaoke_width_pct', v, 'k-width')}
            />
          </Row>
        </Group>

        <Group title="Text">
          <Row label="Text scale" hint="Relative to Text size in Appearance.">
            <SnapSlider
              steps={FONT_SCALE_STEPS}
              value={ui.karaoke_font_scale}
              onChange={(v) => actions.setFont('karaoke', v)}
            />
          </Row>
          <Row label="Alignment">
            <Segmented
              value={ui.karaoke_alignment}
              options={KARAOKE_ALIGNMENT_OPTIONS}
              onChange={(v: string) => actions.karaoke('karaoke_alignment', v)}
            />
          </Row>
          <Row label="Lines">
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
          <Row label="Shade behind lyrics">
            <SnapSlider
              steps={KARAOKE_BACKGROUND_STEPS}
              value={ui.karaoke_bg_opacity}
              onChange={(v) => actions.karaoke('karaoke_bg_opacity', v, 'k-bg')}
            />
          </Row>
        </Group>
      </>
    );
  }

  const textScale = (surface: FloatingSurface, value: number) => (
    <Row label="Text scale" hint="Relative to Text size in Appearance.">
      <SnapSlider steps={FONT_SCALE_STEPS} value={value} onChange={(v) => actions.setFont(surface, v)} />
    </Row>
  );

  if (section === 'main') {
    return (
      <>
        <Group title="Visibility">
          <Row label={`Show ${activeLabel}`}>
            <Toggle value={ui.floating_visible} onChange={() => actions.toggleVisible('main')} />
          </Row>
          <Row label="Show over full-screen apps">
            <Toggle value={ui.floating_show_on_fullscreen} onChange={(v: boolean) => actions.setFullscreen('main', v)} />
          </Row>
          <Row label="Hide when nothing is playing">
            <Toggle value={app.window.hide_when_idle} onChange={(v: boolean) => actions.updateAppSetting('window', 'hide_when_idle', v)} />
          </Row>
        </Group>

        <Group title="Window">
          <Row label="Keep window on top">
            <Toggle value={app.window.always_on_top} onChange={(v: boolean) => actions.updateAppSetting('window', 'always_on_top', v)} />
          </Row>
          <Row label="Click-through" hint="Clicks pass to the window behind Lyra.">
            <Toggle value={app.window.click_through} onChange={(v: boolean) => actions.updateAppSetting('window', 'click_through', v)} />
          </Row>
        </Group>

        <Group title="Lyrics">
          <Row label="Focus on current line" hint="Shows only the current and next line, centered.">
            <Toggle value={app.behavior.karaoke_mode} onChange={(v: boolean) => actions.updateAppSetting('behavior', 'karaoke_mode', v)} />
          </Row>
          {textScale('main', ui.floating_font_scale)}
        </Group>
      </>
    );
  }

  const showCover = ui.island_show_cover ?? true;
  const islandWidth = ui.island_width ?? 600;
  const islandHeight = ui.island_height ?? 72;

  return (
    <>
      <IslandPreview ui={ui} appearance={app.appearance} artworkSrc={artworkSrc} />
      <Group title="Visibility">
        <Row label={`Show ${activeLabel}`}>
          <Toggle value={ui.island_visible} onChange={() => actions.toggleVisible('island')} />
        </Row>
        <Row label="Show over full-screen apps">
          <Toggle value={ui.island_show_on_fullscreen} onChange={(v: boolean) => actions.setFullscreen('island', v)} />
        </Row>
      </Group>

      <Group title="Window">
        <Row label="Lock position" hint="Unlock to drag the island anywhere.">
          <Toggle value={ui.island_locked} onChange={(v: boolean) => actions.setLock(v)} />
        </Row>
        <Row label="Click-through" hint="Clicks pass to the app behind the island, and its controls turn off.">
          <Toggle value={ui.island_click_through} onChange={(v: boolean) => actions.setIslandClickThrough(v)} />
        </Row>
        <Row label="Position">
          <button
            type="button"
            className="action-btn"
            onClick={() => runSettingsAction(actions.resetIslandPosition())}
          >
            Move to top center
          </button>
        </Row>
      </Group>

      <Group title="Size">
        <Row label="Width">
          <SnapSlider
            steps={ISLAND_WIDTH_STEPS}
            value={islandWidth}
            onChange={(v) => actions.setIslandSize(v, islandHeight)}
          />
        </Row>
        <Row label="Height">
          <SnapSlider
            steps={ISLAND_HEIGHT_STEPS}
            value={islandHeight}
            onChange={(v) => actions.setIslandSize(islandWidth, v)}
          />
        </Row>
        {textScale('island', ui.island_font_scale)}
      </Group>

      <Group title="Cover art">
        <Row label="Show cover art">
          <Toggle value={showCover} onChange={(v: boolean) => actions.island('island_show_cover', v)} />
        </Row>
        <Row label="Circular" disabled={!showCover}>
          <Toggle value={ui.island_cover_circle ?? false} onChange={(v: boolean) => actions.island('island_cover_circle', v)} />
        </Row>
        <Row label="Spin while playing" disabled={!showCover}>
          <Toggle value={ui.island_cover_spin ?? false} onChange={(v: boolean) => actions.island('island_cover_spin', v)} />
        </Row>
      </Group>
    </>
  );
}
