# Lyra architecture

This is the current implementation map. The PRD and product documents retain product intent; they are not API or runtime specifications.

## Ownership

| Layer | Location | Responsibility |
|---|---|---|
| React | `apps/desktop-tauri/src/` | Render snapshots and user preferences; invoke commands; subscribe to events |
| Tauri host | `apps/desktop-tauri/src-tauri/src/` | Native windows, tray, platform scheduling, IPC, event routing, persistence-directory selection |
| Shared core | `crates/lyra-core/src/` | Playback adapters, lyric fetching/cache/parsing, render computation, runtime state, settings and offsets |

Business/runtime policy belongs in core. The host supplies OS integration and the application data directory. Core has no Tauri dependency. The host’s `AppState` contains a `Mutex<LyraRuntime>`, `LyricsRefresh`, `UiStateStore`, and transient surface visibility.

## Surfaces and contracts

One Vite SPA serves four Tauri windows: main (`/`), island (`/island`, shown to users as the Marquee), karaoke (`/karaoke`), and settings (`/settings`). On macOS the island and karaoke windows use NSPanels; other platforms use regular window APIs. Native window behavior stays in the host. On MacBook Pros with a Touch Bar the host also renders a native bar (`touch_bar.rs`) with transport controls and the current and next line, which seeks when dragged along; it is not a window and counts as a playback surface while on screen.

Shared wire types live in core `domain.rs` and frontend `types/tauri-contracts.ts`. Playback surfaces mount through `usePlaybackSnapshot`: make the window ready, request an initial snapshot, then subscribe to `playback-tick`. The main window also requests full lyric lines; overlays consume the core-computed visible window. UI preference changes use `ui-settings-changed`, while core settings changes use `app-settings-changed`.

## Playback and rendering

Player adapters (`core/player/`) implement `PlayerAdapter`: each reports every playback session its OS transport can see and accepts commands for those sessions. On macOS, AppleScript adapters cover Spotify and Music.app, and a MediaRemote adapter covers every other Now Playing app (browsers playing YouTube Music, IINA, …) through the vendored mediaremote-adapter, which runs inside the entitled `/usr/bin/perl` and is built by the host's `build.rs`. Windows uses one SMTC adapter and Linux one MPRIS adapter for every media session. `docs/PLAYER_SUPPORT.md` tracks which players and features work on each OS.

The hub flags browser sessions, cleans video-upload titles ("Artist - Title (Official Video)"), drops ads, and keeps one session per app when two transports report it (AppleScript over SMTC/MPRIS over MediaRemote). Lyric lookups for browser media wait for the user's consent (`BehaviorSettings::browser_lyrics`): until then the status is `NotFound { ConsentRequired }`, and the main window asks once. Players without a native track ID use `meta::<artist>::<title>::<seconds>` cache keys so a music video and an album cut of the same song do not share lyrics or offsets.

Lyra follows music only by default. `player::classify` scores each session (service from a page URL or web-app ID, YouTube upload conventions, title words, duration, album, artwork shape) as music, not music, or unsure. `player::policy::decide` applies, in order, a pinned player (the user's choice to follow one app only, which turns off automatic selection), the per-track override, per-app rule, the global "only music" switch, then the classification. Unsure browser media is ignored while `LyricsRefresh::probe` looks it up in the background (only when browser lookups are allowed): lyrics found means music, a confirmed miss means not music. The host's poll driver runs the lookups the hub queues (`take_probes`). Ignored sessions are never followed; when nothing is followed, `PlaybackSnapshot::ignored` names the playing media so the main window can offer "Show lyrics anyway". Policy commands re-poll players before returning so changes apply at once. `PlayerCommand::Raise` (gated by `PlaybackCaps::raise`) brings the followed player forward on its track: a `spotify:` link or Music.app `reveal` via AppleScript, app activation by bundle ID for Now Playing apps, `shell:AppsFolder` for packaged Windows apps, and MPRIS `Raise` on Linux. The main window's source badge uses it; brand glyphs come from Simple Icons (`utils/brand-icons.ts`).

`player::hub::PlayerHub` owns the adapters. `poll()` collects every session, publishes artwork bytes to an in-memory store, and passes the round to `player::registry::SessionRegistry`, which picks the session Lyra follows: the most recently started playing session (a challenger must play for 1.5 s while another session is playing), otherwise the current session even when paused, otherwise the OS's current session. Tracks without a native ID are published only after two identical observations, so half-updated media metadata never triggers a lyric fetch. `control()` routes play/pause, skip, and seek to the adapter that owns the followed session and rejects controls the session's `PlaybackCaps` do not allow. Adapter calls never hold the runtime Mutex; the registry lock covers pure bookkeeping only.

Each `PlaybackSnapshot` carries the player, transport, playback `rate`, `position_quality`, and `caps`. Surfaces disable unsupported controls and do not move the UI for a seek the player cannot perform. Artwork that a player exposes only as bytes is served through the host's `lyra-art` URI scheme so playback ticks carry a short URL instead of an inline image.

Core `runtime.rs` owns the canonical playback observation, current lyric document, cache, transient provider failures, configuration, and offsets. Each `tick()` extrapolates a playing position from the observation time and playback rate without modifying that observation, resolves track changes, and delegates line selection to deterministic `sync::compute_render`. There is no 150 ms debounce or per-window 300 ms polling loop.

The host schedules hub polls and event delivery. The user interval is clamped to 100–2000 ms; inactive states back off, and all-hidden surfaces skip adapter calls. Surfaces report page occlusion (minimized, covered, other Space, locked screen), so hidden windows stop receiving ticks; revealing one triggers an immediate poll. Ready lyrics can schedule an earlier wakeup for the next line boundary, and a track change waiting to settle re-polls after 100 ms. macOS uses a GCD timer with leeway; Windows/Linux use a condvar wait. Playback commands run on the async runtime's blocking pool, not the main thread, then request an immediate poll. Events target visible playback surfaces. Paused/stopped events are coalesced by a signature (which includes duration and artwork, so metadata a player fills in late still arrives) and refreshed by a 10-second heartbeat.

AppleScript adapters (Spotify, Music.app) cache metadata per track. `player::metadata::MetaRefresh` re-reads it about 2 s after a track change and keeps retrying while the duration or artwork is missing: Spotify reports `duration = 0` for 1–2 s while a music video loads.

## Lyric fetching

`lyrics::refresh::LyricsRefresh` owns a provider and in-flight URI claims. Tauri commands delegate to it. It checks current-track/cache eligibility under the runtime lock, releases the lock for the network request, then records the result under the lock. Claims remain held through result storage and are released if the future is cancelled.

LRCLIB prefers synchronized lyrics and can return plain text when timing is unavailable. Plain documents use `Unsynced`, have no active/visible timed lines, and are requested by the main pane through `get_plain_lyrics`; overlays retain their timed-lyrics requirement. Plain text is cached separately from LRC.

A fetched document is stored in the cache and becomes active only if it belongs to the current track. A confirmed provider miss persists a `.nomatch` sentinel, trusted for longer each time the track misses again (1, 3, 7, then 14 days). Transient provider failures stay in memory and render a structured failure reason; they do not become persistent misses. Busy responses and dropped connections are retried within a lookup, and a failed lookup of the playing track is retried in the background with backoff. Manual retry bypasses negative-cache eligibility, preventing a queued sentinel deletion from suppressing the request. Existing lyric documents retain cache precedence.

The frontend automatically requests lyrics once per URI and exposes explicit retry. Status and line-selection policy are computed in core; views render the supplied result.

## Persistence

The host selects `dirs_next::data_dir()/lyra` once and injects it into the stores. On macOS this is `~/Library/Application Support/lyra/`. Startup supports migration from the older capitalized directory.

| Store | Owner | Relative path |
|---|---|---|
| Core configuration | `ConfigStore` | `config.json` |
| Per-track timing | `OffsetStore` | `lyric_offsets.json` |
| Fetched lyrics / negative sentinel | `LyricCache` | `lyrics_cache/` |
| User lyric overrides | `LyricCache` | `lyrics_overrides/` |
| Window and presentation preferences | `UiStateStore` | `ui_state.json` |
| Media following rules and per-track overrides | `MediaPolicyStore` (owned by `PlayerHub`) | `media_policy.json` |
| Players seen before (app identity and last seen only) | `KnownPlayers` (owned by `PlayerHub`) | `known_players.json` |

Track filenames use percent-encoded URIs. Overrides take precedence over fetched lyrics. Network requests never hold the runtime lock. Cache reads and settings/offset writes can still occur while it is held; cache-result writes are separately scheduled. This is not a guarantee that all runtime operations are free of disk I/O.

## Releases and updates

A version tag builds signed installers in CI (`.github/workflows/release.yml`) and publishes them as a GitHub release with fixed file names and a signed `latest.json`. The host's `updater.rs` checks that file in release builds, downloads a newer version quietly, and offers it through the tray menu and Settings → General → Updates (`update-status` event; `get_update_status`, `check_for_updates` and `install_update` commands). The root `Cargo.toml` version is the only version number. Steps and secrets are in `docs/RELEASING.md`.

## Verification

Run `cargo test -p lyra-core` for parser, cache, render, runtime, and refresh-coordinator tests. Run `cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml` for host integration. Frontend changes require `pnpm lint` from `apps/desktop-tauri/`. Platform-specific runtime behavior still requires testing on the relevant OS; a local macOS check does not validate Windows SMTC or Linux D-Bus behavior.
