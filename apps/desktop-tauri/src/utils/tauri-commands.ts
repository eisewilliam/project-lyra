import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  IslandSettingsPatch,
  KaraokeSettingsPatch,
  LyricLineSlim,
  MonitorInfo,
  RenderSnapshot,
  SettingsPatch,
  UiState,
} from '@/types/tauri-contracts';

// Manual contract-alignment checklist for Phase 1:
// - crates/lyra-core/src/domain.rs: TrackRef, PlaybackSnapshot,
//   RenderSnapshot, VisibleLine, LyricWord, LyricsStatus, SettingsSnapshot,
//   SettingsPatch.
// - apps/desktop-tauri/src-tauri/src/ui_state.rs: UiState.
// - apps/desktop-tauri/src-tauri/src/commands.rs: command names, argument
//   payloads, return types, and event payloads.
// - apps/desktop-tauri/src/types/tauri-contracts.ts: frontend mirrors.

export function getUiState(): Promise<UiState> {
  return invoke('get_ui_state');
}

export type SurfaceLabel = 'main' | 'island' | 'karaoke' | 'settings';
export type OverlayLabel = 'island' | 'karaoke';

export function toggleSurface(label: SurfaceLabel): Promise<void> {
  return invoke('toggle_surface', { label });
}

export function setShowOnFullscreen(
  surface: SurfaceLabel,
  value: boolean,
): Promise<void> {
  return invoke('set_show_on_fullscreen', { surface, value });
}

export function setIslandLocked(locked: boolean): Promise<void> {
  return invoke('set_island_locked', { locked });
}

export function setFontScale(surface: SurfaceLabel, scale: number): Promise<void> {
  return invoke('set_font_scale', { surface, scale });
}

export function setTheme(theme: string): Promise<void> {
  return invoke('set_theme', { theme });
}

export function updateIslandSettings(patch: IslandSettingsPatch): Promise<void> {
  return invoke('update_island_settings', { patch });
}

export function updateKaraokeSettings(patch: KaraokeSettingsPatch): Promise<void> {
  return invoke('update_karaoke_settings', { patch });
}

export function setOverlayPosition(label: OverlayLabel, x: number, y: number): Promise<void> {
  return invoke('set_overlay_position', { label, x, y });
}

export function saveIslandPosition(x: number, y: number): Promise<void> {
  return invoke('save_island_position', { x, y });
}

export function setIslandSize(width: number, height: number): Promise<void> {
  return invoke('set_island_size', { width, height });
}

export function getRenderSnapshot(): Promise<RenderSnapshot> {
  return invoke('get_render_snapshot');
}

export function getAllLines(): Promise<LyricLineSlim[]> {
  return invoke('get_all_lines');
}

export function getSettings(): Promise<AppSettings> {
  return invoke('get_settings');
}

export function getLyricOffset(): Promise<number> {
  return invoke('get_lyric_offset');
}

export function setLyricOffset(offsetMs: number): Promise<number> {
  return invoke('set_lyric_offset', { offsetMs });
}

export function nudgeLyricOffset(deltaMs: number): Promise<number> {
  return invoke('nudge_lyric_offset', { deltaMs });
}

export function playbackPlayPause(): Promise<void> {
  return invoke('playback_play_pause');
}

export function playbackNext(): Promise<void> {
  return invoke('playback_next');
}

export function playbackPrevious(): Promise<void> {
  return invoke('playback_previous');
}

export function playbackSeekMs(positionMs: number): Promise<void> {
  return invoke('playback_seek_ms', { positionMs });
}

export function clearLyricsCache(): Promise<void> {
  return invoke('clear_lyrics_cache');
}

export function refreshLyrics(): Promise<void> {
  return invoke('refresh_lyrics');
}

export function forceRefreshLyrics(): Promise<void> {
  return invoke('force_refresh_lyrics');
}

export function updateSettings(patch: SettingsPatch): Promise<void> {
  return invoke('update_settings', { patch });
}

export function getAvailableMonitors(): Promise<MonitorInfo[]> {
  return invoke('get_available_monitors');
}

export function setPreferredMonitor(name: string | null): Promise<void> {
  return invoke('set_preferred_monitor', { name });
}

export function windowReady(label: SurfaceLabel): Promise<void> {
  return invoke('window_ready', { label });
}

export function getAutostartStatus(): Promise<boolean> {
  return invoke('get_autostart_status');
}

export function setAutostart(enabled: boolean): Promise<void> {
  return invoke('set_autostart', { enabled });
}

export function clearMainVibrancy(): Promise<void> {
  return invoke('clear_main_vibrancy');
}

export function applyMainVibrancy(): Promise<void> {
  return invoke('apply_main_vibrancy');
}
