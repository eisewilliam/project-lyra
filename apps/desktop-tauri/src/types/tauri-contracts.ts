export type PlayerSource =
  | 'SpotifyMacOs'
  | 'AppleMusicMacOs'
  | 'WindowsSmtc'
  | 'LinuxMpris';

export type PlaybackState = 'Playing' | 'Paused' | 'Stopped';

export type TrackRef = {
  source: PlayerSource;
  uri: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  artwork_url: string | null;
};

export type PlaybackSnapshot = {
  track: TrackRef | null;
  state: PlaybackState;
  position_ms: number | null;
  observed_at_ms: number;
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

export type NotFoundReason = 'Miss' | 'NetworkError' | 'RateLimit' | 'Instrumental' | 'Classical' | 'Soundtrack';

export type LyricsStatus =
  | 'Loading'
  | 'Ready'
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
  island_locked: boolean;
  island_pos: [number, number] | null;
  island_width: number | null;
  island_height: number | null;
  island_font_scale: number;
  karaoke_font_scale: number;
  floating_font_scale: number;
  island_show_cover: boolean;
  island_cover_circle: boolean;
  island_cover_spin: boolean;
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
