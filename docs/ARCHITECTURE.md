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

One Vite SPA serves four Tauri windows: main (`/`), island (`/island`), karaoke (`/karaoke`), and settings (`/settings`). On macOS the island and karaoke windows use NSPanels; other platforms use regular window APIs. Native window behavior stays in the host.

Shared wire types live in core `domain.rs` and frontend `types/tauri-contracts.ts`. Playback surfaces mount through `usePlaybackSnapshot`: make the window ready, request an initial snapshot, then subscribe to `playback-tick`. The main window also requests full lyric lines; overlays consume the core-computed visible window. UI preference changes use `ui-settings-changed`, while core settings changes use `app-settings-changed`.

## Playback and rendering

Platform adapters own Spotify access: AppleScript on macOS, SMTC on Windows, and MPRIS over the session D-Bus on Linux. The host calls adapters outside the runtime Mutex and stores the resulting observation under a short lock.

Core `runtime.rs` owns the canonical playback observation, current lyric document, cache, transient provider failures, configuration, and offsets. Each `tick()` extrapolates a playing position from the observation time without modifying that observation, resolves track changes, and delegates line selection to deterministic `sync::compute_render`. There is no 150 ms debounce or per-window 300 ms polling loop.

The host schedules adapter polls and event delivery. The user interval is clamped to 100–2000 ms; inactive states back off, and all-hidden surfaces skip adapter calls. Ready lyrics can schedule an earlier wakeup for the next line boundary. macOS uses a GCD timer with leeway; Windows/Linux use a sleep loop. Events target visible playback surfaces. Paused/stopped events are coalesced by a signature and refreshed by a 10-second heartbeat.

## Lyric fetching

`lyrics::refresh::LyricsRefresh` owns a provider and in-flight URI claims. Tauri commands delegate to it. It checks current-track/cache eligibility under the runtime lock, releases the lock for the network request, then records the result under the lock. Claims remain held through result storage and are released if the future is cancelled.

LRCLIB prefers synchronized lyrics and can return plain text when timing is unavailable. Plain documents use `Unsynced`, have no active/visible timed lines, and are requested by the main pane through `get_plain_lyrics`; overlays retain their timed-lyrics requirement. Plain text is cached separately from LRC.

A fetched document is stored in the cache and becomes active only if it belongs to the current track. A confirmed provider miss persists a `.nomatch` sentinel. Transient provider failures stay in memory and render a structured failure reason; they do not become persistent misses. Manual retry bypasses negative-cache eligibility, preventing a queued sentinel deletion from suppressing the request. Existing lyric documents retain cache precedence.

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

Track filenames use percent-encoded URIs. Overrides take precedence over fetched lyrics. Network requests never hold the runtime lock. Cache reads and settings/offset writes can still occur while it is held; cache-result writes are separately scheduled. This is not a guarantee that all runtime operations are free of disk I/O.

## Verification

Run `cargo test -p lyra-core` for parser, cache, render, runtime, and refresh-coordinator tests. Run `cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml` for host integration. Frontend changes require `pnpm lint` from `apps/desktop-tauri/`. Platform-specific runtime behavior still requires testing on the relevant OS; a local macOS check does not validate Windows SMTC or Linux D-Bus behavior.
