# Lyra implementation reference

Read the sections relevant to the files being changed; verify implementation facts
against current code. This content was moved from AGENTS.md without discarding it.

## Architecture

### Layer separation

```
React UI (4 surfaces, single SPA)
    ↕  Tauri commands / events
Rust bridge  (apps/desktop-tauri/src-tauri/src/)
    ↕  function calls
lyra-core  (crates/lyra-core/src/)
    ↕  OS / network
PlayerHub (registry + adapters: AppleScript / SMTC / MPRIS)  +  LrclibClient
```

**Rule**: All business logic lives in `lyra-core`. The Tauri bridge only delegates to it. UI surfaces render state, never compute it.

### The 4 Tauri windows

All windows are served from one Vite SPA. `main.tsx` routes by `window.location.pathname`:

| Window label | URL path | View | Purpose |
|---|---|---|---|
| `main` | `/` | `views/app` | Full lyrics pane + player controls |
| `island` | `/island` | `views/island` | Marquee: the dynamic panel, placed wherever the user likes |
| `karaoke` | `/karaoke` | `views/karaoke` | Fullscreen karaoke overlay |
| `settings` | `/settings` | `views/settings` | Settings UI |

`island` and `karaoke` are macOS NSPanels (always-on-top, non-activating). See `src-tauri/src/macos.rs` for the Objective-C bridge. On Windows and Linux, the same helper functions fall back to regular Tauri window positioning and visibility APIs.

`main` follows "Keep window on top" (`WindowSettings.always_on_top`) only at its normal size. `sync_main_window_on_top` in `lib.rs` drops it to the normal level while the window is maximized or full screen and restores it afterwards; it runs when settings change and on every `Resized` event for `main`. A maximized topmost window would cover every other app, and on Windows nothing can be brought in front of it until it is minimized.

On macOS the island's backdrop is native glass applied with Tauri window effects (`set_island_glass` in `macos.rs`): Liquid Glass on macOS 26+, the HUD material on older versions. A CSS `backdrop-filter` can't replace it, because in a transparent webview it never blurs the desktop. While the island is docked, the glass reaches one corner radius above the window so its top corners are square. Battery saver and macOS Reduce Transparency remove the glass; Reduce Transparency also makes the CSS backdrop opaque. The host publishes the actual effect state through `data-native-glass` after applying effects and on `window_ready`. The glass is dark because the island window's own appearance is set to dark Aqua; don't use Tauri's `set_theme` for this, because on macOS it sets the appearance of the whole app. Liquid Glass in a non-key window draws a frosted "inactive" veil, and the panel is almost never key, so `keep_glass_active` overrides AppKit's private `_hasActiveAppearance` hooks on the overlay panel class, as AppKit's menu windows do.

The Marquee's transparency (`island_transparency`, 0 solid to 1 clearest, 0.5 standard) arrives as `--marquee-transparency` on `.floating-panel`. Up to the standard look it only fills in the tint. Past it, the tint, artwork wash and dim thin out while contrast guards take over: a light smoke layer, brighter unsung words and next line, and a `drop-shadow` haze behind the lyrics (`.is-clear`). Reduce Transparency still forces the opaque backdrop.

The Marquee's size is fitted by the host (`island_size.rs`), never set by the frontend. Sizes are in points, and the saved size is a scale on one base design (`island_scale`: Small 0.85, Medium 1, Large 1.2, Extra large 1.4; `None` is "Match screen", which picks the scale from the display's usable width so the panel looks about the same size on a laptop and a large monitor). `island_base_width` is the width at Medium and `island_lines` picks the one- or two-line height. The width is capped at 45% of the display's usable width. Placed flush with the top of a notched MacBook display and across the notch, the window grows by the notch height and the content is padded below it. `fit_island` runs at startup, when a size setting changes, and when the island moves to another display or onto or off the notch; it keeps the centre and top edge, then emits `island-frame` (also `get_island_frame`). The island sets `--marquee-scale` and `--marquee-notch-inset` from it, and `island.css` writes its lengths as multiples of `--u` so the layout scales as one. Saved states from before scales (`island_width`/`island_height`) are converted once on load.

The Touch Bar (`touch_bar.rs`) is native AppKit, not a window. `NSApp.touchBar` holds previous/play-pause/next and the lyric item (current line in Appearance → Lyric color and Font, next line or lyric status dimmed after it; tapping it opens Lyra), plus the other-items proxy so WebKit's typing suggestions in Settings nest inside it. It is customizable (View → Customize Touch Bar…, or Customize… in Settings → Touch Bar through `customize_touch_bar`; saved by AppKit under `app.lyralyrics.touchbar`). The lyric item is a `LyricsView` (an NSStackView subclass) that VoiceOver reads as one button labelled with both lines and presses through `accessibilityPerformPress`, since VoiceOver can't trigger its tap gesture. Labels tighten their letters before truncating. Only the frontmost app's bar reaches the Touch Bar, so `UiState.touch_bar_control_strip` (Settings → Touch Bar, a Surfaces page listed only when `get_touch_bar_support` finds the Control Strip process; off by default) adds a Lyra button to the Control Strip that presents a second copy of the bar system-modally beside it; while it is up, the system puts a close box at its left and the Control Strip shows its own items again. Only one third-party button fits in the collapsed Control Strip, so Lyra's takes the place of Now Playing. That path uses undocumented calls (`+[NSTouchBarItem addSystemTrayItem:]`, `+[NSTouchBar presentSystemModalTouchBar:placement:systemTrayItemIdentifier:]`, DFRFoundation's `DFRElementSetControlStripPresenceForIdentifier`) resolved at run time, so a macOS that drops them reports the option unavailable. Community reports say the button needs a `.app` bundle, but on macOS 26.6 it also appears for `tauri dev`. The button is re-asserted on app activation, wake and screen unlock, and re-added when the Control Strip process restarts; it is removed on exit. Text changes per line, never per word.

Hover tracking retains its callback owner on the content view rather than leaking it for the process lifetime. It deliberately preserves Tauri/Tao's window delegate: `tauri-nspanel` 2.1.1's built-in hover event handler replaces that delegate and does not forward move/resize events required for docking and position persistence.

### Rust state in `AppState`

`lib.rs` manages one `AppState` registered with Tauri:

```rust
AppState {
    runtime: Mutex<LyraRuntime>,   // core playback, lyrics, settings, offsets
    lyrics: LyricsRefresh,        // core HTTP client + in-flight fetch claims
    players: Arc<PlayerHub>,       // core player adapters + session registry
    ui: UiStateStore,              // host window preferences
    surface_visibility: RuntimeSurfaceVisibility, // transient host visibility + page occlusion
    poll: PollTrigger,             // wakes the poll loop for an immediate adapter read
}
```

`LyraRuntime` lives in `crates/lyra-core/src/runtime.rs`. The host injects its application-support directory through `new_in`; core does not select an OS directory or depend on Tauri. `LyricsRefresh` owns cache eligibility, request deduplication, and result classification. Its runtime lock never spans the network await. Disk cache reads and settings/offset writes can still happen under the runtime lock; cache-result writes are scheduled separately.

### Playback delivery

The host poll driver calls `PlayerHub::poll()`, which queries every platform adapter and lets the session registry choose the followed session. macOS uses a GCD leeway timer; Windows and Linux use the generic loop (a condvar wait). Adapter calls run outside the runtime Mutex. Playback commands (`playback_*`) are async and call `PlayerHub::control()` on the blocking pool; they return an error when no session is followed or the session does not support the control. Playback changes then call `PollTrigger::request_poll`, so every surface reflects them without waiting for the next tick. Cadence follows the configured interval (clamped to 100–2000 ms), backs off for paused/stopped/missing-lyrics states, and skips adapter calls while all playback surfaces are hidden. A Lyra Touch Bar on screen counts as a visible surface for cadence (`touch_bar::is_visible`, decided by `bar_seen`): the app bar only while Lyra is the active app, since AppKit leaves its `visible` set after another app's bar replaces it, and the Control Strip bar by its key-value-observed `visible`; neither while the displays sleep, the screen is locked or another user's session is in front. It does not receive `playback-tick`: with no window visible the tick is not serialized at all. `touch_bar::sync` runs after each tick and touches AppKit only when the bar's content changes. Its text keeps 4.5:1 contrast on the black bar (`Palette`): a lyric color too dark for black is mixed with white, and the dimmed next line falls back to neutral white when that color can't be dimmed legibly. Earlier wakeups can target the next lyric transition without polling the adapter again.

A surface counts as hidden when its persisted preference is off, auto-hide hid it, or its page reports `document.hidden` (minimized, fully covered, another Space, locked screen) through `set_surface_occluded`. A page reports hidden as it unloads and its replacement reports only changes, so `window_ready` clears the surface's occlusion. Hidden surfaces receive no ticks. Revealing one requests an immediate poll and pushes the current snapshot to that window. The paused/stopped coalescing signature includes duration and artwork, so metadata a player fills in late is still delivered.

Adapter polls share one queue, so every Spotify and Music poll script wraps its Apple events in `with timeout`; a timed-out poll reuses the last observation. Polls slower than 1.5 s are logged, as is every page visibility report (`set_surface_occluded`). The island and karaoke windows set `backgroundThrottling` to `disabled`, so WebKit never suspends an overlay that is on screen over another app.

The AppleScript adapters (Spotify, Music.app) cache metadata per track. `player::metadata::MetaRefresh` re-reads it about 2 s after a track change and keeps retrying while the duration or artwork is missing: Spotify reports `duration = 0` for 1–2 s while a music video loads.

`usePlaybackSnapshot` requests an initial `get_render_snapshot`, then listens for `playback-tick` events. It does not poll every 300 ms. The host sends events to visible playback surfaces, coalesces unchanged paused/stopped state, and provides a 10-second heartbeat. `LyraRuntime::tick()` computes a fresh render from the latest observation, extrapolating playing position without mutating the adapter snapshot; it has no debounce.

### Lyrics pipeline

Tauri's `refresh_lyrics` and `force_refresh_lyrics` delegate to `lyrics::refresh::LyricsRefresh`:

1. Read current track and cache eligibility under the runtime lock.
2. Claim the URI to deduplicate simultaneous requests.
3. Fetch from the provider without holding the runtime lock.
4. Store the result under the runtime lock, then release the claim (also released on cancellation).

Confirmed misses (`Ok(None)`) persist a `.nomatch` sentinel. Provider errors are recorded only in memory as `NotFound { reason: NetworkError }`; they do not poison the negative cache. Manual retry bypasses the negative-cache eligibility check and clears transient failure state. Existing cached documents still win.

Render states are `Loading`, `Ready`, `Unsynced`, structured `NotFound` with a reason, or `Error`. No track and confirmed misses use `Miss`; pending uncached tracks use `Loading`. Timed documents use `Ready`; plain text uses `Unsynced` and is exposed only to the main pane through `get_plain_lyrics`. The frontend guards automatic refresh by track URI; manual retry is explicit.

### Persistence stores

| Store | Managed by | Path |
|---|---|---|
| `UiState` | `UiStateStore` in `ui_state.rs` | `~/Library/Application Support/lyra/` |
| Lyrics cache | `LyricCache` in `lyra-core` | `~/Library/Application Support/lyra/lyrics_cache/` |
| Settings (lyra-core) | `ConfigStore` in `lyra-core` | `~/Library/Application Support/lyra/config.json` |
| Lyric offsets (per track) | `OffsetStore` in `lyra-core` | `~/Library/Application Support/lyra/lyric_offsets.json` |
| Media following rules | `MediaPolicyStore` in `lyra-core` (owned by `PlayerHub`) | `~/Library/Application Support/lyra/media_policy.json` |
| Players seen before | `KnownPlayers` in `lyra-core` (owned by `PlayerHub`) | `~/Library/Application Support/lyra/known_players.json` |

The host’s single `app_support_dir()` helper chooses `dirs_next::data_dir()/lyra` and passes that directory to core and UI stores. The paths above show macOS; Windows and Linux use their platform data directory. Keep the directory lowercase so case-sensitive volumes do not split stores.

Cache filenames are percent-encoded track URIs:
- Fetched: `lyrics_cache/spotify%3Atrack%3Aabc123.lrc`
- User override (wins over cache): `lyrics_overrides/spotify%3Atrack%3Aabc123.lrc`
- Plain text: `lyrics_cache/spotify%3Atrack%3Aabc123.txt`
- Negative (no lyrics found): `lyrics_cache/spotify%3Atrack%3Aabc123.nomatch`

### Key lyra-core modules

| File | Role |
|---|---|
| `domain.rs` | All shared types: `TrackRef`, `RenderSnapshot`, `LyricsStatus`, `LyricDocument`, `VisibleLine` |
| `runtime.rs` | Playback observations, lyric state/cache coordination, settings, offsets, and next-transition calculation |
| `lyrics/refresh.rs` | Async provider fetching, in-flight claims, cache eligibility and failure classification |
| `sync.rs` | `compute_render()` — deterministic line selection and visible window computation |
| `player/mod.rs` | `PlayerAdapter` trait, `SessionObservation`, `PlayerCommand`, `ControlError` |
| `player/hub.rs` | `PlayerHub`: polls adapters, publishes artwork bytes, routes commands to the followed session |
| `player/registry.rs` | Pure session selection (recency + 1.5 s hysteresis, sticky pause, OS hint) and metadata settling |
| `player/artwork.rs` | Bounded in-memory artwork store served by the host's `lyra-art` URI scheme |
| `player/metadata.rs` | Metadata cache keys (`meta::artist::title::seconds`), browser detection, app display names, video-title cleanup, ad detection |
| `player/classify.rs` | Music / not music / unsure scoring; service recognition from page URLs, web-app IDs and YouTube conventions; image size parsing |
| `player/known.rs` | Players seen across runs (app identity, transport, last seen; no track data), bounded and lazily persisted |
| `player/policy.rs` | `MediaPolicy` (only-music switch, per-app rules, per-track overrides), `decide()` precedence, `media_policy.json` store |
| `player/applescript.rs` | Shared in-process AppleScript execution (macOS); every compile/execute/release serializes on one lock |
| `player/spotify_macos.rs` | Spotify via AppleScript; running check is **outside** the `tell` block to avoid launching Spotify |
| `player/apple_music_macos.rs` | Music.app via AppleScript: Apple Music streams and local files (persistent ID, file path, raw artwork) |
| `player/mediaremote_macos.rs` | macOS Now Playing (browsers, other apps) through the vendored mediaremote-adapter running in `/usr/bin/perl` |
| `player/smtc_windows.rs` | Windows SMTC: every media session, per-session control flags and playback controls |
| `player/mpris_linux.rs` | Linux MPRIS: every player on the user's D-Bus session bus |
| `lyrics/lrclib.rs` | LRCLIB HTTP client; prefers synced lyrics, falls back to plain lyrics; returns `Ok(None)` only for confirmed misses |
| `lyrics/cache.rs` | Flat-file cache + negative cache + manual override resolution |
| `lyrics/parser.rs` | LRC parser; `parse_lrc(track_key, raw, source)` |

### Linux MPRIS integration

Linux uses MPRIS over the D-Bus session bus, not distro-specific process or package checks. The adapter lists every session bus name that starts with `org.mpris.MediaPlayer2.` (except `playerctld`, which mirrors another player), reads `org.mpris.MediaPlayer2.Player` properties with one `GetAll` plus `Metadata`, and caches each player's `Identity` as its display name.

Important Linux behavior:
- Missing D-Bus session, no players, stopped playback, ads, loading gaps, or incomplete metadata mean no session, which becomes a stopped `PlaybackSnapshot`, not a UI error.
- Linux tracks use `Transport::Mpris`; sessions are keyed `mpris:<bus name>`.
- Spotify cache keys prefer identifiers from `mpris:trackid` or `xesam:url`, falling back to the legacy `mpris::<artist>::<title>` key; other players use `meta::` metadata keys.
- Controls follow `CanControl`, `CanPlay`/`CanPause`, `CanGoNext`, `CanGoPrevious` and `CanSeek`. Seeking uses `SetPosition` with the current `mpris:trackid` object path and a microsecond offset, or a relative `Seek` when the player has no usable track ID.
- `file://` artwork is read (≤10 MiB) and served through `lyra-art`; KDE's `plasma-browser-integration` duplicates of a browser's own session are dropped.
- Keep all Linux playback logic in `crates/lyra-core/src/player/mpris_linux.rs`. Tauri commands and startup code reach it only through `PlayerHub`.

### Frontend patterns

`LyricsStatus` serializes as `"Loading" | "Ready" | "Unsynced"`, `{"NotFound": {"reason": "Miss" | "NetworkError" | "RateLimit"}}`, or `{"Error": "..."}`. Use the shared frontend status helpers for structured variants; plain string comparisons still work for `Loading`, `Ready`, and `Unsynced`.

`RenderSnapshot.playback.caps` lists the controls the followed player accepts; disable the rest and do not apply optimistic seeks when `caps.seek` is false. `PlaybackSnapshot.rate` is the playback speed; core extrapolation already applies it.

`RenderSnapshot` contains both `active_line_index` (used by the `app` view via `get_all_lyrics`) and `visible_lines` (used by `island` and `karaoke`). The `app` view fetches the full lyric array separately via `get_all_lyrics` and highlights by index; the other views use the pre-windowed `visible_lines` directly.

UI-layer state (window lock, position, font scale) flows through `ui-settings-changed` Tauri events. Playback state arrives through the initial `get_render_snapshot` call and `playback-tick` events.

Per-frame work stays on surfaces that need it. Word wipes use Web Animations on registered `--word-progress`, resynchronized from the shared playback baseline after snapshots. Their playback rate follows the baseline's linear correction, returning to normal at the blend boundary. Older webviews use the existing `requestAnimationFrame` fallback. Hidden surfaces cancel both paths. Word-timed long lines in the island and karaoke glide directly from the interpolated clock without React updates per frame; replacing a line clears its transform and edge fades. Progress bars and rings step on a 100–250 ms timer quantized to 0.1% and skip unchanged style writes. The island meter scales fixed-height bars instead of changing layout height. A track with `duration_ms == 0` renders an inert progress rail with a `–:––` total.

Battery saver (`BehaviorSettings::battery_saver`) is core policy: `effective_poll_interval_ms()` returns 1 s while it is on, and otherwise the saved interval capped to 100–500 ms. Settings no longer offers an interval picker, so a slow value saved by an older build is capped. `useSurfaceSettings` mirrors the setting to `<html data-low-power>`. Each surface's CSS then drops backdrop blur, edge animations and compositing hints, halves the lyric depth blur, and the island rests its decorative meter. The host also removes the island's native glass.

The lyric depth blur is user-controlled: `AppearanceSettings::lyric_blur` (0 off, 0.5 subtle, 1 standard, 1.5 strong) becomes `--lyric-blur`. Every lyric blur radius is `base × --lyric-blur × --blur-power`, and `data-lyric-blur="off"` removes the filter. Battery saver sets `--blur-power` to 0.5; Reduce Motion leaves blur alone because blur is not motion.

Settings rows name their controls. `Row` publishes its label (and optional `hint`) ids through `RowContext`, and every control (`Toggle`, `SnapSlider`, `CustomSelect`, `Segmented`) spreads `useRowAria()`, so new rows get accessible names without extra props.

Island interaction (`views/island/hooks/use-interaction.ts`):
- `island_locked` is a position lock only. `island_click_through` (`set_island_click_through`) makes the panel ignore the mouse.
- On macOS, hover and edge proximity come only from a native `NSTrackingArea` (ActiveAlways; enter/exit/move) that emits `island-hover` and `island-edge`, on edge changes only. A non-activating panel's WebKit page can get an enter without the matching leave, so DOM hover is not used there. While hovered, the page re-checks `island_pointer_inside` every 400 ms so effects never linger. DOM pointer events drive hover and edges on the other platforms.
- A press that moves more than 4 px drags the island by setting its position each frame (only when unlocked). Otherwise it is a click: the cover raises the player and the meter (on hover the `TransportGlyph`) toggles playback. Opening the main window (`open_main_window`) takes a double-click (within 450 ms and 6 px) anywhere else, so a stray click on the lyrics does nothing.
- The edge handles appear only near their edge, resize the island around its centre within the widths its size allows on that display, and persist the width at Medium size (`island_base_width`) once on release. A horizontal trackpad swipe skips tracks.
- Hover transitions are 250 ms or shorter in both directions.

`components/transport-glyph.tsx` is the shared play/pause mark: two bars that fold into a triangle by interpolating `clip-path`. It is used by the island control, the main play button and the shortcut confirmation.

Main window feedback:
- `useTrackSkip` dims the lyrics as soon as a skip is requested; native menu skips announce themselves with `transport-skip`.
- Track changes crossfade the cover and the ambient wash through `useCrossfadeSrc`, which decodes the incoming image before fading it over the outgoing one.
- The paused cover scales to 0.92.
- The lyric reel supports free scrolling (`isBrowsing`, `returnToCurrent`, 4 s idle return).
- The progress bar shows a scrub preview with the time and the lyric line at that point.
- Lyric lines have a native context menu (`useLineMenu`, with `copy_text` through the clipboard plugin).
- Keyboard shortcuts show a brief on-screen confirmation.

First run and permission (macOS): `UiState::onboarded` (a fresh install starts with false; saved states without the field count as true) gates `player::set_automation_enabled`. Until the user continues past `FirstRunCard`, the AppleScript readers stay idle, so macOS's Automation prompt follows Lyra's explanation. The readers record `errAEEventNotPermitted` (-1743) per player. `get_automation_denied` feeds the empty state's "Open Privacy Settings" guidance (`open_automation_settings`).

The menu-bar menu mirrors the followed track (title – artist, Play/Pause, Next Track) through `TrayMenuRefs::sync_now_playing`, which only writes when something visible changed.

Settings pages show live previews (`views/settings/components/previews.tsx`) built from the same values the surfaces read. Appearance's preview scrolls with its settings; the island and karaoke previews are pinned above the scrolling body (`PinnedPreview` in `components/body.tsx`). The island preview reuses the real island markup, scaled. Settings layout, tokens and control specs follow `docs/design/settings/DESIGN.md`, with revisions from review: no sidebar wordmark; each group is one quiet fill-only surface (no border or shadow) under a 13 px semibold heading, with a faint inset rule between rows inside a panel (none after the last row, under headings or around panels); and soft custom stroke icons in place of Phosphor Regular. Add a horizontal line only when it does a job, such as those row rules or the scroll-edge hairline under the fixed title. The Players page refreshes itself every 3 s while open.

Native chrome: macOS has an app menu (`src-tauri/src/menu.rs`): About Lyra (icon, version, copyright), Check for Updates… (release builds with an updater key; opens General), Settings… (⌘,), Playback key equivalents (⌘←/⌘→) and a Help menu linking releases and issues. On macOS 26 Lyra's own items get SF Symbols to match AppKit's standard items. The main window handles Space and ←/→ in-page (`use-main-keyboard-shortcuts.ts`). Production builds suppress the WebView context menu outside editable fields (`utils/native-feel.ts`). The browser IPC mock is loaded only in dev outside Tauri.

Updates (`src-tauri/src/updater.rs`): release builds with a real `plugins.updater.pubkey` check `latest.json` 20 s after launch and every 6 h, download in the background, and set `UpdateStatus::Ready`. That adds "Restart to Install Lyra x.y" to the tray (`TrayMenuRefs::show_update_ready`) and emits `update-status` for Settings → General → Updates (`views/settings/components/updates-group.tsx`). `install_update` installs and restarts. Debug builds report `unavailable` and never check. Release builds pass `--config src-tauri/tauri.release.conf.json` to create signed update bundles; see `docs/RELEASING.md`.

Frontend OS styling is selected through `body[data-os]`. Linux must be detected as `linux` instead of falling through to macOS styles; shared playback UI should stay platform-neutral and consume `RenderSnapshot`.
