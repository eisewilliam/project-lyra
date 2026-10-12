/** OS mechanism used to observe a player; not the player itself. */
export type Transport = 'AppleScript' | 'MediaRemote' | 'Smtc' | 'Mpris';

export type PlayerApp = {
  id: string;
  name: string;
};

export type PlaybackState = 'Playing' | 'Paused' | 'Stopped';

/** Whether media is music; Lyra follows only music unless overridden. */
export type MediaKind = 'Music' | 'NotMusic' | 'Unsure';

/** Why Lyra is not following a playing session. */
export type IgnoreReason =
  | 'Podcast'
  | 'VideoService'
  | 'NotMusicSignals'
  | 'NoLyricsFound'
  | 'Checking'
  | 'Unconfirmed'
  | 'AppRule'
  | 'MarkedNotMusic'
  | 'OtherPlayerSelected';

/** Playing media Lyra chose not to follow, reported while idle. */
export type IgnoredMedia = {
  track_key: string;
  title: string;
  artist: string;
  player: PlayerApp;
  platform: string | null;
  reason: IgnoreReason;
};

export type FollowRule = 'Auto' | 'Always' | 'Never';

export type MediaPolicyView = {
  /** Follow only this player; null selects automatically. */
  pinned_app: PlayerApp | null;
  only_music: boolean;
  app_rules: Record<string, FollowRule>;
};

export type TrackRef = {
  player: PlayerApp;
  transport: Transport;
  /** Canonical track key for lyric cache and offsets. */
  uri: string;
  native_id: string | null;
  /** Playing in a web browser; lyric lookups need the user's consent. */
  from_browser: boolean;
  /** Service inside the app when recognisable, e.g. "YouTube" in a browser. */
  platform: string | null;
  kind: MediaKind;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  artwork_url: string | null;
};

export type PositionQuality = 'Exact' | 'Extrapolated' | 'Missing';

/** Controls the followed player accepts; unsupported controls stay disabled. */
export type PlaybackCaps = {
  play_pause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  /** Lyra can bring the player to the front, showing the track. */
  raise: boolean;
};

export type PlaybackSnapshot = {
  track: TrackRef | null;
  state: PlaybackState;
  position_ms: number | null;
  observed_at_ms: number;
  rate: number;
  position_quality: PositionQuality;
  caps: PlaybackCaps;
  ignored: IgnoredMedia | null;
};

/** A player Lyra has seen, with the user's settings for it. */
export type KnownPlayerInfo = {
  app: PlayerApp;
  transport: Transport;
  last_seen_ms: number;
  /** Reporting a playback session right now. */
  running: boolean;
  rule: FollowRule;
  /** Lyra is set to follow only this player. */
  pinned: boolean;
};

/** Diagnostics view of one observed playback session. */
export type PlayerSessionInfo = {
  id: string;
  player: PlayerApp | null;
  transport: Transport;
  state: PlaybackState;
  title: string | null;
  artist: string | null;
  platform: string | null;
  kind: MediaKind | null;
  track_key: string | null;
  ignored: IgnoreReason | null;
  /** The user's per-track override; true = music. */
  marked_music: boolean | null;
  app_rule: FollowRule;
  position_quality: PositionQuality;
  caps: PlaybackCaps;
  os_current: boolean;
  active: boolean;
};

export type LyricWord = {
  start_ms: number;
  end_ms: number;
  text: string;
};

export type VisibleLine = {
  index: number;
  text: string;
  is_active: boolean;
};

export type NotFoundReason =
  | 'Miss'
  | 'NetworkError'
  | 'RateLimit'
  /** Browser media; the user has not decided about lyric lookups yet. */
  | 'ConsentRequired'
  /** Browser media; the user turned lyric lookups off. */
  | 'LookupDisabled';

export type LyricsStatus =
  | 'Loading'
  | 'Ready'
  | 'Unsynced'
  | { NotFound: { reason: NotFoundReason } }
  | { Error: string };

export type RenderSnapshot = {
  playback: PlaybackSnapshot;
  lyrics_status: LyricsStatus;
  active_line_index: number | null;
  line_progress: number | null;
  visible_lines: VisibleLine[];
  active_line_words: LyricWord[] | null;
};

export type LyricLineSlim = {
  start_ms: number;
  text: string;
};

export type UiState = {
  island_visible: boolean;
  floating_visible: boolean;
  karaoke_visible: boolean;
  /** Position lock: no dragging; hover and clicks still work. */
  island_locked: boolean;
  /** The island ignores the mouse; clicks reach the app behind it. */
  island_click_through: boolean;
  island_pos: [number, number] | null;
  island_width: number | null;
  island_height: number | null;
  island_font_scale: number;
  karaoke_font_scale: number;
  floating_font_scale: number;
  island_show_cover: boolean;
  island_cover_circle: boolean;
  island_cover_spin: boolean;
  /** 0 solid … 1 clearest; 0.5 is the standard look. */
  island_transparency: number;
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
  autostart_enabled: boolean;
  preferred_monitor: string | null;
  /** The first-run explanation has been acknowledged. */
  onboarded: boolean;
};

export type WindowSettings = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  always_on_top: boolean;
  click_through: boolean;
  hide_when_idle: boolean;
};

export type AppearanceSettings = {
  font_family: string;
  font_size: number;
  text_color: string;
  background_opacity: number;
  context_lines_above: number;
  context_lines_below: number;
  /** Depth blur strength around the current line: 0 = off, 1 = standard. */
  lyric_blur: number;
};

/** Whether lyrics may be looked up for media playing in a web browser. */
export type BrowserLyrics = 'Ask' | 'Allow' | 'Deny';

export type BehaviorSettings = {
  karaoke_mode: boolean;
  poll_interval_ms: number;
  hide_when_paused: boolean;
  browser_lyrics: BrowserLyrics;
  battery_saver: boolean;
};

export type AppSettings = {
  window: WindowSettings;
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
};

export type SettingsPatch = Partial<{
  window: WindowSettings;
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
}>;

export type UiStatePatch = Partial<UiState>;

export type IslandSettingsPatch = Partial<{
  show_cover: boolean;
  cover_circle: boolean;
  cover_spin: boolean;
  transparency: number;
}>;

export type KaraokeSettingsPatch = Partial<{
  position: string;
  alignment: string;
  width_pct: number;
  offset_px: number;
  lines: number;
  bg_opacity: number;
  bold: boolean;
}>;

export type MonitorInfo = {
  name: string | null;
  width: number;
  height: number;
  x: number;
  y: number;
  scale_factor: number;
  is_primary: boolean;
};

/** Mirrors `updater::UpdateStatus` in the Tauri host. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date'; checked_at_ms: number }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'failed'; checked_at_ms: number }
  | { state: 'unavailable' };

/** Payload of `get_update_status` and the `update-status` event. */
export type UpdateInfo = {
  current_version: string;
  status: UpdateStatus;
};
