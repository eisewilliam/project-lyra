import type { CSSProperties } from 'react';
import type { AppearanceSettings, UiState } from '@/types/tauri-contracts';
import { resolveFontFamily } from '@/utils/app-settings';

// Live previews at the top of Appearance, Marquee and Karaoke, so a
// setting's effect is visible without switching to another window. They read
// the same values the surfaces do and use the current track's artwork.

const SAMPLE = {
  previous: 'City lights are humming low',
  current: 'Every word lands right on time',
  next: 'And the next line waits in view',
};

/** Fraction of the current line already sung, for the static wipe. */
const SAMPLE_PROGRESS = 0.55;
const ISLAND_PREVIEW_SCALE = 0.6;

function WipedLine({ text, className }: Readonly<{ text: string; className: string }>) {
  return (
    <span className={className} style={{ '--word-progress': SAMPLE_PROGRESS } as CSSProperties}>
      {text}
    </span>
  );
}

export function AppearancePreview({
  appearance,
  artworkSrc,
}: Readonly<{ appearance: AppearanceSettings; artworkSrc: string }>) {
  const style = {
    '--lyric-color': appearance.text_color || '#ffffff',
    '--lyric-blur': String(appearance.lyric_blur ?? 1),
    '--bg-darkness': String(appearance.background_opacity),
    fontFamily: resolveFontFamily(appearance.font_family),
    fontSize: `${(appearance.font_size || 16) / 16}rem`,
  } as CSSProperties;

  return (
    <div className="settings-preview preview-main" style={style} aria-hidden="true">
      <img className="preview-ambient" src={artworkSrc} alt="" />
      <div className="preview-dimmer" />
      <div className="preview-main-lines">
        <span className="preview-line is-passed">{SAMPLE.previous}</span>
        <WipedLine text={SAMPLE.current} className="preview-line is-active" />
        <span className="preview-line is-next">{SAMPLE.next}</span>
      </div>
    </div>
  );
}

export function IslandPreview({
  ui,
  appearance,
  artworkSrc,
}: Readonly<{ ui: UiState; appearance: AppearanceSettings; artworkSrc: string }>) {
  const width = ui.island_width ?? 600;
  const height = ui.island_height ?? 72;
  const compact = height <= 64;
  return (
    <div
      className="settings-preview preview-island"
      style={{ height: `${Math.round(height * ISLAND_PREVIEW_SCALE) + 36}px` }}
      aria-hidden="true"
    >
      {/* Real island markup at its real size, scaled down: widths and heights
          stay comparable as the sliders move. */}
      <div
        className="preview-island-frame"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          '--font-scale': String(ui.island_font_scale),
          '--preview-scale': String(ISLAND_PREVIEW_SCALE),
          // The island reads these from its own root; mirror them here.
          '--bg-darkness': String(appearance.background_opacity),
          '--lyric-color': appearance.text_color || '#ffffff',
        } as CSSProperties}
      >
        <div className={`floating-panel docked ${compact ? 'is-compact' : ''}`}>
          <div className="island-background">
            <img src={artworkSrc} alt="" className="island-bg-img" />
            <div className="island-bg-dimmer" />
          </div>
          <div className="panel-content">
            {ui.island_show_cover && (
              <div className="panel-art-container" style={{ position: 'relative', flexShrink: 0 }}>
                <div className={`panel-art ${ui.island_cover_circle ? 'is-circle' : ''} ${ui.island_cover_spin ? 'is-spinning' : ''}`}>
                  <img src={artworkSrc} className="panel-cover" alt="" draggable={false} />
                </div>
              </div>
            )}
            <div className="panel-lyrics-stack">
              <div className="panel-lyric-active">
                <WipedLine text={SAMPLE.current} className="preview-island-wipe" />
              </div>
              <div className="panel-lyric-next">{SAMPLE.next}</div>
            </div>
            <div className="island-meter">
              <div className="audio-bars is-playing">
                {[9, 15, 11, 6].map((h, i) => (
                  <span key={i} className="bar" style={{ '--meter-height': `${h}px`, '--meter-opacity': '0.85' } as CSSProperties} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KaraokePreview({
  ui,
  appearance,
}: Readonly<{ ui: UiState; appearance: AppearanceSettings }>) {
  const style = {
    '--lyric-color': appearance.text_color || '#ffffff',
    '--karaoke-bg': String(ui.karaoke_bg_opacity),
    '--preview-scale': String(ui.karaoke_font_scale),
    '--preview-width': `${ui.karaoke_width_pct}%`,
    fontFamily: resolveFontFamily(appearance.font_family),
    textAlign: ui.karaoke_alignment as CSSProperties['textAlign'],
    '--preview-align': { left: 'flex-start', right: 'flex-end' }[ui.karaoke_alignment] ?? 'center',
    justifyContent: ui.karaoke_position === 'top' ? 'flex-start' : 'flex-end',
  } as CSSProperties;

  return (
    <div className="settings-preview preview-karaoke" style={style} aria-hidden="true">
      <div className="preview-karaoke-band">
        <WipedLine
          text={SAMPLE.current}
          className={`preview-karaoke-current ${ui.karaoke_bold ? 'is-bold' : ''}`}
        />
        {ui.karaoke_lines >= 2 && <span className="preview-karaoke-next">{SAMPLE.next}</span>}
      </div>
    </div>
  );
}
