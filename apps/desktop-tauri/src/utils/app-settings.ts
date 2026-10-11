// Shared mirror of the Rust `SettingsSnapshot` (lyra-core `domain.rs`) plus a
// helper that applies the appearance-related fields to the current surface as
// CSS custom properties. Used by every lyric surface so font/colour/darkness
// settings take effect uniformly.

import type { AppearanceSettings, BehaviorSettings } from '@/types/tauri-contracts';

export type { AppSettings, AppearanceSettings, BehaviorSettings, WindowSettings } from '@/types/tauri-contracts';

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
 * - `--lyric-blur`         → multiplier on the depth blur around the current
 *                            line; `data-lyric-blur="off"` drops the filter
 */
export function applyAppearance(a: AppearanceSettings) {
  const root = document.documentElement;
  const blur = Math.max(0, Math.min(2, a.lyric_blur ?? 1));
  root.style.setProperty('--lyric-blur', String(blur));
  if (blur === 0) {
    root.dataset.lyricBlur = 'off';
  } else {
    delete root.dataset.lyricBlur;
  }
  root.style.setProperty('--lyric-color', a.text_color || '#ffffff');
  root.style.setProperty('--bg-darkness', String(Math.max(0, Math.min(1, a.background_opacity))));
  root.style.setProperty('--app-font-family', resolveFontFamily(a.font_family));
  if (a.font_size && a.font_size > 0) {
    root.style.fontSize = `${a.font_size}px`;
  }
}

/**
 * Battery saver halves the lyric blur and drops other GPU-heavy effects
 * (backdrop blur, edge animations, compositing hints) through the
 * `data-low-power` rules in each surface's CSS.
 */
export function applyBatterySaver(b: BehaviorSettings) {
  const root = document.documentElement;
  if (b.battery_saver) {
    root.dataset.lowPower = 'true';
  } else {
    delete root.dataset.lowPower;
  }
}
