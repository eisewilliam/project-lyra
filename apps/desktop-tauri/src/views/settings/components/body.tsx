import {
  ActionFeedbackButton,
  CustomSelect,
  Group,
  Row,
  Segmented,
  SnapSlider,
  Toggle,
} from '@/components/settings-controls';
import { ISLAND_SCALE_STEPS, islandScaleLabel } from '@/constants/island-size';
import { useIslandFrame } from '@/hooks/use-island-frame';
import type { MonitorInfo } from '@/types/tauri-contracts';
import { runSettingsAction } from '@/utils/settings-action-runner';
import {
  BACKGROUND_OPACITY_STEPS,
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_STEPS,
  FONT_SIZE_STEPS,
  ISLAND_TRANSPARENCY_STEPS,
  ISLAND_WIDTH_STEPS,
  KARAOKE_ALIGNMENT_OPTIONS,
  KARAOKE_BACKGROUND_STEPS,
  KARAOKE_OFFSET_STEPS,
  KARAOKE_POSITION_OPTIONS,
  KARAOKE_WIDTH_STEPS,
  LINE_COUNT_OPTIONS,
  LYRIC_BLUR_STEPS,
  THEME_OPTIONS,
} from '../settings-options';
import type { FloatingSurface, SettingsBodyProps } from '../types';
import { PlayersSection } from './players-section';
import { AppearancePreview, IslandPreview, KaraokePreview } from './previews';
import { UpdatesGroup } from './updates-group';

const MATCH_SCREEN = 'match-screen';

/** Size of the Marquee: a fixed size, or matched to whichever display it is
    on. While matched, the option names the size picked for that display. */
function IslandSizeRow({
  scale,
  onChange,
}: Readonly<{ scale: number | null; onChange: (scale: number | null) => Promise<void> }>) {
  const frame = useIslandFrame();
  const matched = frame?.auto_scale ? ` (${islandScaleLabel(frame.scale)})` : '';
  const options = [
    { value: MATCH_SCREEN, label: `Match screen${matched}` },
    ...ISLAND_SCALE_STEPS.map((step) => ({ value: String(step.value), label: step.label })),
  ];
  return (
    <Row label="Size" hint="Match screen picks a size for each display.">
      <CustomSelect
        value={scale === null ? MATCH_SCREEN : String(scale)}
        options={options}
        onChange={(v) => onChange(v === MATCH_SCREEN ? null : Number(v))}
      />
    </Row>
  );
}

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

        <UpdatesGroup />
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
          <Row label="Background darkness" hint="Main window and Marquee.">
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
              options={LINE_COUNT_OPTIONS}
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
          <Row label="Keep window on top" hint="Not while the window is maximized or full screen.">
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

  return (
    <>
      <IslandPreview ui={ui} appearance={app.appearance} artworkSrc={artworkSrc} />
      <Group title="Visibility">
        <Row label={`Show ${activeLabel}`} hint="A dynamic panel above your other windows, wherever you place it.">
          <Toggle value={ui.island_visible} onChange={() => actions.toggleVisible('island')} />
        </Row>
        <Row label="Show over full-screen apps">
          <Toggle value={ui.island_show_on_fullscreen} onChange={(v: boolean) => actions.setFullscreen('island', v)} />
        </Row>
      </Group>

      <Group title="Window">
        <Row label="Lock position" hint="Unlock to drag the Marquee anywhere.">
          <Toggle value={ui.island_locked} onChange={(v: boolean) => actions.setLock(v)} />
        </Row>
        <Row label="Click-through" hint="Clicks pass to the app behind the Marquee, and its controls turn off.">
          <Toggle value={ui.island_click_through} onChange={(v: boolean) => actions.setIslandClickThrough(v)} />
        </Row>
        <Row label="Position">
          <button
            type="button"
            className="action-btn"
            onClick={() => runSettingsAction(actions.resetIslandPosition())}
          >
            Reset position
          </button>
        </Row>
      </Group>

      <Group title="Layout">
        <IslandSizeRow scale={ui.island_scale ?? null} onChange={actions.setIslandSize} />
        <Row label="Width">
          <SnapSlider
            steps={ISLAND_WIDTH_STEPS}
            value={ui.island_base_width ?? 600}
            onChange={(v) => actions.island('island_base_width', v, 'island-width')}
          />
        </Row>
        <Row label="Lines">
          <Segmented
            value={String(ui.island_lines ?? 2)}
            options={LINE_COUNT_OPTIONS}
            onChange={(v: string) => actions.island('island_lines', Number.parseInt(v, 10))}
          />
        </Row>
        {textScale('island', ui.island_font_scale)}
      </Group>

      <Group title="Background">
        <Row label="Transparency" hint="Lyrics keep their contrast at every level.">
          <SnapSlider
            steps={ISLAND_TRANSPARENCY_STEPS}
            value={ui.island_transparency ?? 0.5}
            onChange={(v) => actions.island('island_transparency', v, 'island-transparency')}
          />
        </Row>
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
