// Shared mirror of the Rust `SettingsSnapshot` (lyra-core `domain.rs`) plus a
// helper that applies the appearance-related fields to the current surface as
// CSS custom properties. Used by every lyric surface so font/colour/darkness
// settings take effect uniformly.

export type AppearanceSettings = {
  font_family: string;
  font_size: number;
  text_color: string;
  background_opacity: number;
  context_lines_above: number;
  context_lines_below: number;
};

export type WindowSettings = {
  click_through: boolean;
  hide_when_idle: boolean;
  always_on_top: boolean;
};

export type BehaviorSettings = {
  karaoke_mode: boolean;
  poll_interval_ms: number;
  hide_when_paused: boolean;
};

export type AppSettings = {
  window: WindowSettings;
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
};

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Resolve a stored font_family value to a usable CSS font-family string. */
export function resolveFontFamily(value: string | undefined): string {
  if (!value || value === 'System' || value === 'system-ui') return SYSTEM_FONT_STACK;
  return value;
}

/**
 * Apply appearance settings as CSS custom properties + base font size.
 *
 * - `--lyric-color`        → active-lyric text colour (consumed in each view CSS)
 * - `--bg-darkness`        → 0..1 opacity of the background dim overlay
 * - `--app-font-family`    → resolved font stack (index.css consumes it on
 *                            html/body/#root, so it actually reaches the text —
 *                            #root has its own font-family rule that would
 *                            otherwise win over an inherited body style)
 * - root `font-size`       → base px the rem-based lyric sizing scales from
 */
export function applyAppearance(a: AppearanceSettings) {
  const root = document.documentElement;
  root.style.setProperty('--lyric-color', a.text_color || '#ffffff');
  root.style.setProperty('--bg-darkness', String(Math.max(0, Math.min(1, a.background_opacity))));
  root.style.setProperty('--app-font-family', resolveFontFamily(a.font_family));
  if (a.font_size && a.font_size > 0) {
    root.style.fontSize = `${a.font_size}px`;
  }
}
