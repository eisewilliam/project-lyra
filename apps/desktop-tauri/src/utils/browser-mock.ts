import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { islandBaseHeight } from '@/constants/island-size';
import type {
  AppSettings,
  IslandFrame,
  IslandSettingsPatch,
  KaraokeSettingsPatch,
  UiState,
  UpdateInfo,
  RenderSnapshot,
  LyricLineSlim,
  LyricWord,
  VisibleLine,
  KnownPlayerInfo,
  MediaPolicyView,
  PlaybackCaps,
  PlaybackSnapshot,
  PlayerSessionInfo,
  TrackRef,
  PlaybackState,
  NotFoundReason,
} from '@/types/tauri-contracts';

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window);

if (!isTauri) {
  console.log('🚀 [Lyra Mock] Activating browser development mock...');

  // --- Mock Data ---
  const MOCK_PLAYER = {
    player: { id: 'com.spotify.client', name: 'Spotify' },
    transport: 'AppleScript',
    native_id: null,
    from_browser: false,
    platform: null,
    kind: 'Music',
  } satisfies Pick<TrackRef, 'player' | 'transport' | 'native_id' | 'from_browser' | 'platform' | 'kind'>;
  const MOCK_CAPS: PlaybackCaps = { play_pause: true, next: true, previous: true, seek: true, raise: true };

  const MOCK_TRACKS: {
    track: TrackRef;
    lines: { start_ms: number; end_ms: number; text: string }[];
  }[] = [
    {
      track: {
        ...MOCK_PLAYER,
        uri: 'spotify:track:stay',
        title: 'Stay',
        artist: 'The Kid LAROI, Justin Bieber',
        album: 'F*CK LOVE 3: OVER YOU',
        duration_ms: 140000,
        artwork_url: '/stay_cover.jpg',
      },
      lines: [
        { start_ms: 0, end_ms: 8000, text: '♪ (Instrumental Intro) ♪' },
        { start_ms: 8000, end_ms: 11000, text: 'I do the same thing I told you that I never would' },
        { start_ms: 11500, end_ms: 15000, text: "I told you I'd change, even when I knew I never could" },
        { start_ms: 15500, end_ms: 19000, text: "I know that I can't find nobody else as good as you" },
        { start_ms: 19500, end_ms: 23000, text: 'Need you to stay, need you to stay, yeah' },
        { start_ms: 24000, end_ms: 27000, text: "I get drunk, wake up, I'm wasted still" },
        { start_ms: 27500, end_ms: 31000, text: 'I realize the time that I wasted here' },
        { start_ms: 31500, end_ms: 35000, text: "I feel like you can't feel the way I feel" },
        { start_ms: 35500, end_ms: 39000, text: "Oh, I'll be fucked up if you can't be right here" },
        { start_ms: 39500, end_ms: 43000, text: 'Oh, ooh-woah, oh, ooh-woah, oh, ooh-woah' },
        { start_ms: 43500, end_ms: 47000, text: "Oh, I'll be fucked up if you can't be right here" },
        { start_ms: 47500, end_ms: 50500, text: 'I do the same thing I told you that I never would' },
        { start_ms: 51000, end_ms: 54500, text: "I told you I'd change, even when I knew I never could" },
        { start_ms: 55000, end_ms: 58500, text: "I know that I can't find nobody else as good as you" },
        { start_ms: 59000, end_ms: 62500, text: 'Need you to stay, need you to stay, yeah' },
        { start_ms: 63000, end_ms: 66500, text: 'When I’m away from you, I miss your touch' },
        { start_ms: 67000, end_ms: 70500, text: 'You’re the reason I believe in love' },
        { start_ms: 71000, end_ms: 74500, text: 'It’s been difficult for me to trust' },
        { start_ms: 75000, end_ms: 78500, text: 'And I’m afraid that I’ma fuck it up' },
        { start_ms: 79000, end_ms: 82500, text: 'Ain’t no way that I can leave you stranded' },
        { start_ms: 83000, end_ms: 86500, text: '‘Cause you ain’t ever left me empty-handed' },
        { start_ms: 87000, end_ms: 90500, text: 'And you know that I know that I can’t live without you' },
        { start_ms: 91000, end_ms: 94000, text: 'So baby, stay...' },
        { start_ms: 94000, end_ms: 140000, text: '♪ (Instrumental Outro) ♪' }
      ]
    },
    {
      track: {
        ...MOCK_PLAYER,
        uri: 'spotify:track:blindinglights',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        duration_ms: 200000,
        artwork_url: '/blinding_lights_cover.jpg',
      },
      lines: [
        { start_ms: 0, end_ms: 6000, text: '♪ (Synth Intro) ♪' },
        { start_ms: 6000, end_ms: 10000, text: 'Yeah...' },
        { start_ms: 10000, end_ms: 14500, text: "I've been tryna call" },
        { start_ms: 15000, end_ms: 19500, text: "I've been on my own for long enough" },
        { start_ms: 20000, end_ms: 24500, text: 'Maybe you can show me how to love, maybe' },
        { start_ms: 25000, end_ms: 29500, text: "I'm going through withdrawals" },
        { start_ms: 30000, end_ms: 34500, text: "You don't even have to do too much" },
        { start_ms: 35000, end_ms: 39500, text: 'You can turn me on with just a touch, baby' },
        { start_ms: 40000, end_ms: 44500, text: "I look around and Sin City's cold and empty" },
        { start_ms: 45000, end_ms: 49500, text: "No one's around to judge me" },
        { start_ms: 50000, end_ms: 54500, text: "I can't see clearly when you're gone" },
        { start_ms: 55000, end_ms: 59500, text: "I said, ooh, I'm blinded by the lights" },
        { start_ms: 60000, end_ms: 64500, text: "No, I can't sleep until I feel your touch" },
        { start_ms: 65000, end_ms: 200000, text: '♪ (Music playing to end) ♪' }
      ]
    },
    {
      track: {
        ...MOCK_PLAYER,
        uri: 'spotify:track:bohemianrhapsody',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        album: 'A Night at the Opera',
        duration_ms: 355000,
        artwork_url: '/bohemian_rhapsody_cover.jpg',
      },
      lines: [
        { start_ms: 0, end_ms: 4000, text: 'Is this the real life? Is this just fantasy?' },
        { start_ms: 4500, end_ms: 9000, text: 'Caught in a landslide, no escape from reality' },
        { start_ms: 9500, end_ms: 14000, text: 'Open your eyes, look up to the skies and see' },
        { start_ms: 14500, end_ms: 19000, text: "I'm just a poor boy, I need no sympathy" },
        { start_ms: 19500, end_ms: 22000, text: "Because I'm easy come, easy go, little high, little low" },
        { start_ms: 22500, end_ms: 27000, text: "Any way the wind blows doesn't really matter to me, to me" },
        { start_ms: 27500, end_ms: 32000, text: 'Mama, just killed a man' },
        { start_ms: 32500, end_ms: 38000, text: "Put a gun against his head, pulled my trigger, now he's dead" },
        { start_ms: 38500, end_ms: 355000, text: '♪ (Rock opera playing to end) ♪' }
      ]
    }
  ];

  // --- Defaults ---
  const defaultSettings: AppSettings = {
    window: {
      x: null,
      y: null,
      width: 800,
      height: 600,
      always_on_top: false,
      click_through: false,
      hide_when_idle: false,
    },
    appearance: {
      font_family: 'System',
      font_size: 16,
      text_color: '#ffffff',
      background_opacity: 0.8,
      context_lines_above: 2,
      context_lines_below: 3,
      lyric_blur: 1,
    },
    behavior: {
      karaoke_mode: false,
      poll_interval_ms: 300,
      hide_when_paused: false,
      browser_lyrics: 'Ask',
      battery_saver: false,
    },
  };

  const defaultUiState: UiState = {
    island_visible: false,
    floating_visible: true,
    karaoke_visible: false,
    island_locked: false,
    island_click_through: false,
    island_pos: null,
    island_scale: null,
    island_base_width: 600,
    island_lines: 2,
    island_font_scale: 1.0,
    karaoke_font_scale: 1.0,
    floating_font_scale: 1.0,
    island_show_cover: true,
    island_cover_circle: true,
    island_cover_spin: true,
    island_transparency: 0.5,
    island_show_on_fullscreen: false,
    karaoke_show_on_fullscreen: false,
    floating_show_on_fullscreen: false,
    theme: 'dark',
    karaoke_position: 'bottom',
    karaoke_alignment: 'center',
    karaoke_width_pct: 80,
    karaoke_offset_px: 20,
    karaoke_lines: 2,
    karaoke_bg_opacity: 0.5,
    karaoke_bold: true,
    autostart_enabled: false,
    preferred_monitor: null,
    touch_bar_control_strip: false,
    onboarded: true,
  };

  const LOCAL_STORAGE_SETTINGS_KEY = 'lyra-mock-settings';
  const LOCAL_STORAGE_UI_KEY = 'lyra-mock-uistate';

  // --- Local States ---
  let settings: AppSettings =
    JSON.parse(localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY) || 'null') || defaultSettings;
  let uiState: UiState =
    JSON.parse(localStorage.getItem(LOCAL_STORAGE_UI_KEY) || 'null') || defaultUiState;
  uiState.floating_visible = true;

  let currentTrackIdx = Number(localStorage.getItem('lyra-mock-current-track') || '0');
  let playbackState: PlaybackState =
    (localStorage.getItem('lyra-mock-state') as PlaybackState) || 'Playing';
  let positionMs = Number(localStorage.getItem('lyra-mock-position') || '0');
  let observedAtMs = Date.now();

  const getMockOffset = (uri: string) =>
    Number(localStorage.getItem(`lyra-mock-offset:${uri}`)) || 0;
  const setMockOffset = (uri: string, offsetMs: number) =>
    localStorage.setItem(`lyra-mock-offset:${uri}`, String(offsetMs));

  // --- State Persistence Helpers ---
  const saveSettings = () => {
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  };
  const saveUiState = () => {
    localStorage.setItem(LOCAL_STORAGE_UI_KEY, JSON.stringify(uiState));
  };
  /** The host's fit (`island_size.rs`) for a 1512-point laptop display. */
  const mockIslandFrame = (): IslandFrame => {
    const scale = uiState.island_scale ?? 0.85;
    const maxWidth = 680;
    return {
      scale,
      auto_scale: uiState.island_scale == null,
      width: Math.round(Math.min((uiState.island_base_width ?? 600) * scale, maxWidth)),
      height: Math.round(islandBaseHeight(uiState.island_lines ?? 2) * scale),
      notch_inset: 0,
      max_width: maxWidth,
    };
  };

  // --- Word Interpolation ---
  const interpolateWords = (text: string, startMs: number, endMs: number): LyricWord[] => {
    const tokens = text.match(/\S+\s*/g) || [];
    if (tokens.length === 0) return [];

    const weights = tokens.map((t) => Math.max(1, t.trim().length));
    const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));
    const totalMs = Math.max(0, endMs - startMs);

    const result: LyricWord[] = [];
    let cursor = startMs;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i] ?? '';
      const w = weights[i] ?? 1;
      const dur = Math.floor((totalMs * w) / totalWeight);
      const wordEnd = i === tokens.length - 1 ? endMs : cursor + dur;
      result.push({
        start_ms: cursor,
        end_ms: wordEnd,
        text: tok,
      });
      cursor = wordEnd;
    }
    return result;
  };

  // --- Compute Render Snapshot ---
  const computeRenderSnapshot = (): RenderSnapshot => {
    const trackData = MOCK_TRACKS[currentTrackIdx];
    if (!trackData) {
      return {
        playback: {
          track: null,
          state: 'Stopped',
          position_ms: null,
          observed_at_ms: Date.now(),
          rate: 1,
          position_quality: 'Missing',
          caps: { play_pause: false, next: false, previous: false, seek: false, raise: false },
          ignored: null,
        },
        lyrics_status: { NotFound: { reason: 'Miss' as NotFoundReason } },
        active_line_index: null,
        line_progress: null,
        visible_lines: [],
        active_line_words: null,
      };
    }

    const offset = getMockOffset(trackData.track.uri);
    const adjustedPos = Math.max(0, positionMs - offset);

    const playback: PlaybackSnapshot = {
      track: trackData.track,
      state: playbackState,
      position_ms: positionMs,
      observed_at_ms: observedAtMs,
      rate: 1,
      position_quality: 'Exact',
      caps: MOCK_CAPS,
      ignored: null,
    };

    let activeIdx: number | null = null;
    const lines = trackData.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.start_ms <= adjustedPos) {
        activeIdx = i;
      } else {
        break;
      }
    }

    let lineProgress: number | null = null;
    if (activeIdx !== null) {
      const line = lines[activeIdx];
      if (line) {
        const span = line.end_ms - line.start_ms;
        if (span > 0) {
          lineProgress = Math.max(0, Math.min(1, (adjustedPos - line.start_ms) / span));
        }
      }
    }

    let activeLineWords: LyricWord[] | null = null;
    if (activeIdx !== null) {
      const line = lines[activeIdx];
      if (line) {
        const words = interpolateWords(line.text, line.start_ms, line.end_ms);
        activeLineWords = words.map((w) => ({
          start_ms: Math.max(0, w.start_ms + offset),
          end_ms: Math.max(0, w.end_ms + offset),
          text: w.text,
        }));
      }
    }

    const contextAbove = settings.appearance.context_lines_above;
    const contextBelow = settings.appearance.context_lines_below;
    const visibleLines: VisibleLine[] = [];

    const start = activeIdx !== null ? Math.max(0, activeIdx - contextAbove) : 0;
    const end =
      activeIdx !== null
        ? Math.min(lines.length, activeIdx + contextBelow + 1)
        : Math.min(lines.length, contextBelow + 1);

    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (line) {
        visibleLines.push({
          index: i,
          text: line.text,
          is_active: i === activeIdx,
        });
      }
    }

    return {
      playback,
      lyrics_status: 'Ready',
      active_line_index: activeIdx,
      line_progress: lineProgress,
      visible_lines: visibleLines,
      active_line_words: activeLineWords,
    };
  };

  const get_all_lines = (): LyricLineSlim[] => {
    const trackData = MOCK_TRACKS[currentTrackIdx];
    if (!trackData) return [];
    return trackData.lines.map((l) => ({
      start_ms: l.start_ms,
      text: l.text,
    }));
  };

  // --- Initialize Mocks ---
  const path = window.location.pathname;
  let surface = 'main';
  if (path === '/island') surface = 'island';
  else if (path === '/karaoke') surface = 'karaoke';
  else if (path === '/settings') surface = 'settings';

  mockWindows(surface, 'main', 'island', 'karaoke', 'settings');

  let mockUpdateInfo: UpdateInfo = {
    current_version: '0.1.0',
    status: { state: 'up_to_date', checked_at_ms: Date.now() - 3 * 60 * 60 * 1000 },
  };

  mockIPC(async (cmd, args) => {
    switch (cmd) {
      case 'get_ui_state':
        return uiState;

      case 'toggle_surface': {
        const { label } = args as { label: string };
        if (label === 'island') uiState.island_visible = !uiState.island_visible;
        else if (label === 'karaoke') uiState.karaoke_visible = !uiState.karaoke_visible;
        else if (label === 'floating') uiState.floating_visible = !uiState.floating_visible;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_show_on_fullscreen': {
        const { surface: surf, value } = args as { surface: string; value: boolean };
        if (surf === 'island') uiState.island_show_on_fullscreen = value;
        else if (surf === 'karaoke') uiState.karaoke_show_on_fullscreen = value;
        else if (surf === 'floating') uiState.floating_show_on_fullscreen = value;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_island_locked': {
        const { locked } = args as { locked: boolean };
        uiState.island_locked = locked;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_island_click_through': {
        const { enabled } = args as { enabled: boolean };
        uiState.island_click_through = enabled;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'open_main_window':
        return;

      case 'get_automation_denied':
        return [];

      case 'get_update_status':
        return mockUpdateInfo;

      case 'get_touch_bar_support':
        return { present: true, control_strip: true };

      case 'set_touch_bar_control_strip': {
        const { enabled } = args as { enabled: boolean };
        uiState.touch_bar_control_strip = enabled;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'check_for_updates': {
        mockUpdateInfo = { ...mockUpdateInfo, status: { state: 'checking' } };
        void emit('update-status', mockUpdateInfo);
        globalThis.setTimeout(() => {
          mockUpdateInfo = { ...mockUpdateInfo, status: { state: 'up_to_date', checked_at_ms: Date.now() } };
          void emit('update-status', mockUpdateInfo);
        }, 900);
        return;
      }

      case 'install_update':
        return;

      case 'open_automation_settings':
      case 'copy_text':
        return;

      case 'complete_onboarding': {
        uiState.onboarded = true;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_font_scale': {
        const { surface: surf, scale } = args as { surface: string; scale: number };
        if (surf === 'island') uiState.island_font_scale = scale;
        else if (surf === 'karaoke') uiState.karaoke_font_scale = scale;
        else if (surf === 'floating') uiState.floating_font_scale = scale;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_theme': {
        const { theme } = args as { theme: string };
        uiState.theme = theme;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'update_island_settings': {
        // The host takes the patch's short field names (see surface-maps).
        const { patch } = args as { patch: IslandSettingsPatch };
        if (patch.show_cover !== undefined) uiState.island_show_cover = patch.show_cover;
        if (patch.cover_circle !== undefined) uiState.island_cover_circle = patch.cover_circle;
        if (patch.cover_spin !== undefined) uiState.island_cover_spin = patch.cover_spin;
        if (patch.transparency !== undefined) uiState.island_transparency = patch.transparency;
        if (patch.scale !== undefined) uiState.island_scale = patch.scale;
        if (patch.match_screen) uiState.island_scale = null;
        if (patch.base_width !== undefined) uiState.island_base_width = patch.base_width;
        if (patch.lines !== undefined) uiState.island_lines = patch.lines;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        void emit('island-frame', mockIslandFrame());
        return;
      }

      case 'update_karaoke_settings': {
        const { patch } = args as { patch: KaraokeSettingsPatch };
        if (patch.position !== undefined) uiState.karaoke_position = patch.position;
        if (patch.alignment !== undefined) uiState.karaoke_alignment = patch.alignment;
        if (patch.width_pct !== undefined) uiState.karaoke_width_pct = patch.width_pct;
        if (patch.offset_px !== undefined) uiState.karaoke_offset_px = patch.offset_px;
        if (patch.lines !== undefined) uiState.karaoke_lines = patch.lines;
        if (patch.bg_opacity !== undefined) uiState.karaoke_bg_opacity = patch.bg_opacity;
        if (patch.bold !== undefined) uiState.karaoke_bold = patch.bold;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_overlay_position': {
        const { label, x, y } = args as { label: string; x: number; y: number };
        if (label === 'island') uiState.island_pos = [x, y];
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'save_island_position': {
        const { x, y } = args as { x: number; y: number };
        uiState.island_pos = x === -1 && y === -1 ? null : [x, y];
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'get_island_frame':
        return mockIslandFrame();

      case 'get_render_snapshot':
        return computeRenderSnapshot();

      case 'get_all_lines':
        return get_all_lines();

      case 'get_settings':
        return settings;

      case 'get_lyric_offset': {
        const trackData = MOCK_TRACKS[currentTrackIdx];
        return trackData ? getMockOffset(trackData.track.uri) : 0;
      }

      case 'set_lyric_offset': {
        const { offsetMs } = args as { offsetMs: number };
        const trackData = MOCK_TRACKS[currentTrackIdx];
        if (trackData) {
          setMockOffset(trackData.track.uri, offsetMs);
        }
        void emit('playback-tick', computeRenderSnapshot());
        return offsetMs;
      }

      case 'nudge_lyric_offset': {
        const { deltaMs } = args as { deltaMs: number };
        const trackData = MOCK_TRACKS[currentTrackIdx];
        if (trackData) {
          const current = getMockOffset(trackData.track.uri);
          const updated = current + deltaMs;
          setMockOffset(trackData.track.uri, updated);
          void emit('playback-tick', computeRenderSnapshot());
          return updated;
        }
        return 0;
      }

      case 'playback_play_pause': {
        playbackState = playbackState === 'Playing' ? 'Paused' : 'Playing';
        observedAtMs = Date.now();
        localStorage.setItem('lyra-mock-state', playbackState);
        void emit('playback-tick', computeRenderSnapshot());
        return;
      }

      case 'playback_next': {
        currentTrackIdx = (currentTrackIdx + 1) % MOCK_TRACKS.length;
        positionMs = 0;
        observedAtMs = Date.now();
        localStorage.setItem('lyra-mock-current-track', String(currentTrackIdx));
        localStorage.setItem('lyra-mock-position', '0');
        void emit('playback-tick', computeRenderSnapshot());
        return;
      }

      case 'playback_previous': {
        currentTrackIdx = (currentTrackIdx - 1 + MOCK_TRACKS.length) % MOCK_TRACKS.length;
        positionMs = 0;
        observedAtMs = Date.now();
        localStorage.setItem('lyra-mock-current-track', String(currentTrackIdx));
        localStorage.setItem('lyra-mock-position', '0');
        void emit('playback-tick', computeRenderSnapshot());
        return;
      }

      case 'playback_seek_ms': {
        const { positionMs: pos } = args as { positionMs: number };
        positionMs = pos;
        observedAtMs = Date.now();
        localStorage.setItem('lyra-mock-position', String(positionMs));
        void emit('playback-tick', computeRenderSnapshot());
        return;
      }

      case 'get_player_sessions': {
        const trackData = MOCK_TRACKS[currentTrackIdx];
        if (!trackData) return [] satisfies PlayerSessionInfo[];
        return [{
          id: 'applescript:com.spotify.client',
          player: trackData.track.player,
          transport: trackData.track.transport,
          state: playbackState,
          title: trackData.track.title,
          artist: trackData.track.artist,
          platform: null,
          kind: 'Music',
          track_key: trackData.track.uri,
          ignored: null,
          marked_music: null,
          app_rule: 'Auto',
          position_quality: 'Exact',
          caps: MOCK_CAPS,
          os_current: false,
          active: true,
        }, {
          id: 'mediaremote:com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod',
          player: { id: 'com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod', name: 'YouTube Music' },
          transport: 'MediaRemote',
          state: 'Paused',
          title: 'DESPECHÁ',
          artist: 'ROSALÍA',
          platform: 'YouTube Music',
          kind: 'Music',
          track_key: 'meta::rosal%C3%ADa::despech%C3%A1::157',
          ignored: null,
          marked_music: null,
          app_rule: 'Auto',
          position_quality: 'Extrapolated',
          caps: MOCK_CAPS,
          os_current: true,
          active: false,
        }, {
          id: 'mediaremote:com.google.Chrome',
          player: { id: 'com.google.Chrome', name: 'Google Chrome' },
          transport: 'MediaRemote',
          state: 'Playing',
          title: 'I Survived 100 Days in the Wilderness',
          artist: 'MrBeast',
          platform: null,
          kind: 'NotMusic',
          track_key: 'meta::mrbeast::i%20survived::1500',
          ignored: 'NotMusicSignals',
          marked_music: null,
          app_rule: 'Auto',
          position_quality: 'Extrapolated',
          caps: MOCK_CAPS,
          os_current: false,
          active: false,
        }] satisfies PlayerSessionInfo[];
      }

      case 'get_known_players':
        return [
          {
            app: { id: 'com.spotify.client', name: 'Spotify' },
            transport: 'AppleScript',
            last_seen_ms: Date.now(),
            running: true,
            rule: 'Auto',
            pinned: false,
          },
          {
            app: { id: 'com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod', name: 'YouTube Music' },
            transport: 'MediaRemote',
            last_seen_ms: Date.now() - 3 * 60 * 60 * 1000,
            running: false,
            rule: 'Auto',
            pinned: false,
          },
          {
            app: { id: 'com.apple.Music', name: 'Apple Music' },
            transport: 'AppleScript',
            last_seen_ms: Date.now() - 4 * 24 * 60 * 60 * 1000,
            running: false,
            rule: 'Never',
            pinned: false,
          },
        ] satisfies KnownPlayerInfo[];

      case 'forget_player':
      case 'get_media_policy':
      case 'set_pinned_app':
      case 'set_only_music':
      case 'set_app_rule':
      case 'set_track_override':
        return { pinned_app: null, only_music: true, app_rules: {} } satisfies MediaPolicyView;

      case 'playback_raise':
        return;

      case 'clear_lyrics_cache':
        return;

      case 'refresh_lyrics':
        return;

      case 'force_refresh_lyrics':
        return;

      case 'update_settings': {
        const { patch } = args as { patch: Partial<AppSettings> };
        if (patch.window) settings.window = { ...settings.window, ...patch.window };
        if (patch.appearance) settings.appearance = { ...settings.appearance, ...patch.appearance };
        if (patch.behavior) settings.behavior = { ...settings.behavior, ...patch.behavior };
        saveSettings();
        void emit('app-settings-changed', settings);
        return;
      }

      case 'get_available_monitors':
        return [
          {
            name: 'Mock Monitor',
            width: 1920,
            height: 1080,
            x: 0,
            y: 0,
            scale_factor: 1,
            is_primary: true,
          },
        ];

      case 'set_preferred_monitor': {
        const { name } = args as { name: string | null };
        uiState.preferred_monitor = name;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'window_ready':
        return;

      case 'get_autostart_status':
        return uiState.autostart_enabled;

      case 'set_autostart': {
        const { enabled } = args as { enabled: boolean };
        uiState.autostart_enabled = enabled;
        saveUiState();
        void emit('ui-settings-changed', uiState);
        return;
      }

      case 'set_surface_occluded':
        return;

      default:
        console.warn(`[Lyra Mock] Unmocked Tauri command: ${cmd}`, args);
    }
  }, { shouldMockEvents: true });

  // --- Background Ticker ---
  setInterval(() => {
    if (playbackState === 'Playing') {
      const now = Date.now();
      const elapsed = now - observedAtMs;
      observedAtMs = now;

      const track = MOCK_TRACKS[currentTrackIdx];
      if (track) {
        positionMs += elapsed;
        if (positionMs >= track.track.duration_ms) {
          positionMs = 0;
        }
        localStorage.setItem('lyra-mock-position', String(positionMs));
      }
    } else {
      observedAtMs = Date.now();
    }
    void emit('playback-tick', computeRenderSnapshot());
  }, 100);

  // --- Cross-Tab Sync via Storage Events ---
  window.addEventListener('storage', (e) => {
    if (e.key === LOCAL_STORAGE_SETTINGS_KEY) {
      settings = JSON.parse(e.newValue || 'null') || defaultSettings;
      void emit('app-settings-changed', settings);
    } else if (e.key === LOCAL_STORAGE_UI_KEY) {
      uiState = JSON.parse(e.newValue || 'null') || defaultUiState;
      void emit('ui-settings-changed', uiState);
    } else if (e.key && e.key.startsWith('lyra-mock-offset:')) {
      void emit('playback-tick', computeRenderSnapshot());
    } else if (e.key === 'lyra-mock-position') {
      positionMs = Number(e.newValue) || 0;
      observedAtMs = Date.now();
      void emit('playback-tick', computeRenderSnapshot());
    } else if (e.key === 'lyra-mock-current-track') {
      currentTrackIdx = Number(e.newValue) || 0;
      positionMs = 0;
      observedAtMs = Date.now();
      void emit('playback-tick', computeRenderSnapshot());
    } else if (e.key === 'lyra-mock-state') {
      playbackState = (e.newValue as PlaybackState) || 'Playing';
      observedAtMs = Date.now();
      void emit('playback-tick', computeRenderSnapshot());
    }
  });
}
