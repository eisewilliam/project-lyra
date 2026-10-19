import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  BrowserLyrics,
  FollowRule,
  KnownPlayerInfo,
  MediaPolicyView,
  IslandFrame,
  IslandSettingsPatch,
  KaraokeSettingsPatch,
  LyricLineSlim,
  MonitorInfo,
  PlayerSessionInfo,
  RenderSnapshot,
  SettingsPatch,
  TouchBarSupport,
  UiState,
  UpdateInfo,
} from '@/types/tauri-contracts';

// Manual contract-alignment checklist for Phase 1:
// - crates/lyra-core/src/domain.rs: TrackRef, PlaybackSnapshot,
//   PlaybackCaps, PlayerSessionInfo, RenderSnapshot, VisibleLine, LyricWord,
//   LyricsStatus, SettingsSnapshot, SettingsPatch.
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

export function setIslandClickThrough(enabled: boolean): Promise<void> {
  return invoke('set_island_click_through', { enabled });
}

export function openMainWindow(): Promise<void> {
  return invoke('open_main_window');
}

export function completeOnboarding(): Promise<void> {
  return invoke('complete_onboarding');
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

/** After a drag: the host settles the island into its display's safe area
    and saves where it ends up. */
export function settleIslandPosition(): Promise<void> {
  return invoke('settle_island_position');
}

export function resetIslandPosition(): Promise<void> {
  return invoke('reset_island_position');
}

export function getIslandFrame(): Promise<IslandFrame | null> {
  return invoke('get_island_frame');
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

export function playbackRaise(): Promise<void> {
  return invoke('playback_raise');
}

export function getPlayerSessions(): Promise<PlayerSessionInfo[]> {
  return invoke('get_player_sessions');
}

export function setBrowserLyrics(choice: BrowserLyrics): Promise<void> {
  return invoke('set_browser_lyrics', { choice });
}

export function getMediaPolicy(): Promise<MediaPolicyView> {
  return invoke('get_media_policy');
}

export function getKnownPlayers(): Promise<KnownPlayerInfo[]> {
  return invoke('get_known_players');
}

/** Forget a player and its settings; it reappears if it plays again. */
export function forgetPlayer(appId: string): Promise<MediaPolicyView> {
  return invoke('forget_player', { appId });
}

/** Follow only this player, or choose automatically with `null`. */
export function setPinnedApp(appId: string | null): Promise<MediaPolicyView> {
  return invoke('set_pinned_app', { appId });
}

export function setOnlyMusic(onlyMusic: boolean): Promise<MediaPolicyView> {
  return invoke('set_only_music', { onlyMusic });
}

export function setAppRule(appId: string, rule: FollowRule): Promise<MediaPolicyView> {
  return invoke('set_app_rule', { appId, rule });
}

/** `true` marks the track as music, `false` as not music, `null` clears. */
export function setTrackOverride(trackKey: string, isMusic: boolean | null): Promise<MediaPolicyView> {
  return invoke('set_track_override', { trackKey, isMusic });
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

export function setSurfaceOccluded(label: SurfaceLabel, occluded: boolean): Promise<void> {
  return invoke('set_surface_occluded', { label, occluded });
}

export function getPlainLyrics(): Promise<string | null> {
  return invoke<string | null>('get_plain_lyrics');
}

export function copyText(text: string): Promise<void> {
  return invoke('copy_text', { text });
}

export function getAutomationDenied(): Promise<string[]> {
  return invoke('get_automation_denied');
}

export function openAutomationSettings(): Promise<void> {
  return invoke('open_automation_settings');
}

export function getTouchBarSupport(): Promise<TouchBarSupport> {
  return invoke('get_touch_bar_support');
}

/** One row of a host-drawn menu, or a separator when `id` is absent. */
export type NativeMenuRow = {
  id?: string;
  title?: string;
  symbol?: string;
  subtitle?: string;
  enabled?: boolean;
};

/** macOS only: show a system menu at a point in the window (or at the
 * pointer) and resolve with the chosen row's id once it closes. */
export function showNativeMenu(
  items: NativeMenuRow[],
  at: { x: number; y: number } | null,
): Promise<string | null> {
  return invoke('show_native_menu', { items, x: at?.x ?? null, y: at?.y ?? null });
}

export function customizeTouchBar(): Promise<void> {
  return invoke('customize_touch_bar');
}

export function setTouchBarControlStrip(enabled: boolean): Promise<void> {
  return invoke('set_touch_bar_control_strip', { enabled });
}

export function getUpdateStatus(): Promise<UpdateInfo> {
  return invoke('get_update_status');
}

/** Starts a check; progress arrives as `update-status` events. */
export function checkForUpdates(): Promise<void> {
  return invoke('check_for_updates');
}

/** Installs the downloaded update and restarts Lyra. */
export function installUpdate(): Promise<void> {
  return invoke('install_update');
}

export function islandPointerInside(): Promise<boolean> {
  return invoke('island_pointer_inside');
}
