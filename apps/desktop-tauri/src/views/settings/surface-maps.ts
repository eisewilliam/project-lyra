import type {
  IslandSettingsPatch,
  KaraokeSettingsPatch,
  UiState,
} from '@/types/tauri-contracts';
import type { Surface } from './types';

export const SURFACE_VISIBILITY_KEYS: Record<Surface, keyof UiState> = {
  main: 'floating_visible',
  island: 'island_visible',
  karaoke: 'karaoke_visible',
};

export const SURFACE_FULLSCREEN_KEYS: Record<Surface, keyof UiState> = {
  main: 'floating_show_on_fullscreen',
  island: 'island_show_on_fullscreen',
  karaoke: 'karaoke_show_on_fullscreen',
};

export const SURFACE_FONT_SCALE_KEYS: Record<Surface, keyof UiState> = {
  main: 'floating_font_scale',
  island: 'island_font_scale',
  karaoke: 'karaoke_font_scale',
};

export const ISLAND_SETTINGS_FIELDS: Partial<Record<keyof UiState, keyof IslandSettingsPatch>> = {
  island_show_cover: 'show_cover',
  island_cover_circle: 'cover_circle',
  island_cover_spin: 'cover_spin',
  island_transparency: 'transparency',
  island_base_width: 'base_width',
  island_lines: 'lines',
};

export const KARAOKE_SETTINGS_FIELDS: Partial<Record<keyof UiState, keyof KaraokeSettingsPatch>> = {
  karaoke_position: 'position',
  karaoke_alignment: 'alignment',
  karaoke_width_pct: 'width_pct',
  karaoke_offset_px: 'offset_px',
  karaoke_lines: 'lines',
  karaoke_bg_opacity: 'bg_opacity',
  karaoke_bold: 'bold',
};
