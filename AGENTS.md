# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

All frontend commands run from `apps/desktop-tauri/`. All Rust commands run from the repo root unless noted.

```bash
# Dev (hot reload, opens Tauri windows)
cd apps/desktop-tauri && pnpm tauri dev

# Production build
cd apps/desktop-tauri && pnpm tauri build

# Rust tests (lyra-core only — no integration tests exist yet)
cargo test -p lyra-core

# Single test
cargo test -p lyra-core <test_name>

# Type-check Rust without full compile
cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml

# Frontend lint
cd apps/desktop-tauri && pnpm lint
```

## Architecture

### Layer separation

```
React UI (4 surfaces, single SPA)
    ↕  Tauri commands / events
Rust bridge  (apps/desktop-tauri/src-tauri/src/)
    ↕  function calls
lyra-core  (crates/lyra-core/src/)
    ↕  OS / network
SpotifyMacOsAdapter / SpotifyWindowsAdapter / SpotifyLinuxAdapter  +  LrclibClient
```

**Rule**: All business logic lives in `lyra-core`. The Tauri bridge only delegates to it. UI surfaces render state, never compute it.

### The 4 Tauri windows

All windows are served from one Vite SPA. `main.tsx` routes by `window.location.pathname`:

| Window label | URL path | View | Purpose |
|---|---|---|---|
| `main` | `/` | `views/app` | Full lyrics pane + player controls |
| `island` | `/island` | `views/island` | Dynamic Island-style mini overlay |
| `karaoke` | `/karaoke` | `views/karaoke` | Fullscreen karaoke overlay |
| `settings` | `/settings` | `views/settings` | Settings UI |

`island` and `karaoke` are macOS NSPanels (always-on-top, non-activating). See `src-tauri/src/macos.rs` for the Objective-C bridge. On Windows and Linux, the same helper functions fall back to regular Tauri window positioning and visibility APIs.

### Rust state in `AppState`

`lib.rs` manages one `AppState` registered with Tauri:

```rust
AppState {
    runtime: Mutex<LyraRuntime>,   // playback snapshot, lyric doc, settings
    lrclib: LrclibClient,          // HTTP client (lives outside Mutex so network calls don't block)
    ui: UiStateStore,              // window visibility, island position, font scales
    fetch_in_flight: Mutex<HashSet<String>>,  // prevents duplicate lyric fetches
}
```

`LyraRuntime` holds the single `last_playback_snapshot`, the current `LyricDocument`, and the `LyricCache`. It never holds the lock across any blocking call.

### Polling architecture

A background poller (spawned at startup in `lib.rs`) owns the platform Spotify adapter. macOS uses a GCD leeway timer; Windows and Linux use the generic sleep-based loop. Each loop calls `rt.set_playback_snapshot(snapshot)` under the runtime Mutex — a fast write. The Mutex is never held while AppleScript, SMTC, or D-Bus work runs.

All three UI windows poll `get_render_snapshot` (a Tauri command) every 300ms. `LyraRuntime::tick()` has a 150ms debounce so at most one real computation fires per burst of calls from multiple windows.

### Lyrics pipeline

`refresh_lyrics` command:
1. Lock → read `current_track()` + check negative/cached → release lock
2. Check `fetch_in_flight` → insert URI or return early (dedup)
3. HTTP call to lrclib (no lock held)
4. Release in-flight claim
5. Lock → `store_lyrics(doc)` or `store_negative(uri)` → release lock

Status transitions in `tick()`:
- No track → `NotFound`
- Track + `current_doc` loaded → `Ready`
- Track + negative cache entry → `NotFound`
- Track + no doc and no negative → `Loading`

The frontend only calls `refresh_lyrics` once per URI (guarded by `refreshedUriRef`). A failed HTTP fetch stores a negative so status transitions out of `Loading`.

### Persistence stores

| Store | Managed by | Path |
|---|---|---|
| `UiState` | `UiStateStore` in `ui_state.rs` | `~/Library/Application Support/lyra/` |
| Lyrics cache | `LyricCache` in `lyra-core` | `~/Library/Application Support/lyra/lyrics_cache/` |
| Settings (lyra-core) | `ConfigStore` in `lyra-core` | `~/Library/Application Support/lyra/config.json` |
| Lyric offsets (per track) | `OffsetStore` in `lyra-core` | `~/Library/Application Support/lyra/lyric_offsets.json` |

Both `app_support_dir()` helpers (`lib.rs` and `runtime.rs`) spell the directory
`lyra` — keep them identical so case-sensitive volumes don't split the stores.

Cache filenames are percent-encoded track URIs:
- Fetched: `lyrics_cache/spotify%3Atrack%3Aabc123.lrc`
- User override (wins over cache): `lyrics_overrides/spotify%3Atrack%3Aabc123.lrc`
- Negative (no lyrics found): `lyrics_cache/spotify%3Atrack%3Aabc123.nomatch`

### Key lyra-core modules

| File | Role |
|---|---|
| `domain.rs` | All shared types: `TrackRef`, `RenderSnapshot`, `LyricsStatus`, `LyricDocument`, `VisibleLine` |
| `sync.rs` | `compute_render()` — deterministic line selection and visible window computation |
| `player/spotify_macos.rs` | AppleScript polling; running check is **outside** the `tell` block to avoid launching Spotify |
| `player/spotify_windows.rs` | Windows SMTC polling and playback controls |
| `player/spotify_linux.rs` | Linux MPRIS polling over the user's D-Bus session bus |
| `lyrics/lrclib.rs` | LRCLIB HTTP client; returns `Ok(None)` when no synced lyrics (not `Err`) |
| `lyrics/cache.rs` | Flat-file cache + negative cache + manual override resolution |
| `lyrics/parser.rs` | LRC parser; `parse_lrc(track_key, raw, source)` |

### Linux Spotify integration

Linux uses MPRIS over the D-Bus session bus, not distro-specific process or package checks. The adapter discovers Spotify by scanning session bus names that start with `org.mpris.MediaPlayer2.spotify`, then reads `org.mpris.MediaPlayer2.Player` properties from `/org/mpris/MediaPlayer2`.

Important Linux behavior:
- Missing D-Bus session, missing Spotify MPRIS service, stopped playback, ads, loading gaps, or incomplete metadata should become a stopped `PlaybackSnapshot`, not a UI error.
- `PlayerSource::LinuxMpris` is the source for Linux tracks.
- Track cache keys prefer Spotify identifiers from `mpris:trackid` or `xesam:url`; when Spotify does not expose a usable URI, fall back to a stable synthetic `mpris::<artist>::<title>` key.
- Playback controls (`PlayPause`, `Next`, `Previous`, `SetPosition`) are sent through MPRIS. `SetPosition` must use the current `mpris:trackid` object path plus a microsecond offset.
- Keep all Linux playback logic in `crates/lyra-core/src/player/spotify_linux.rs`. Tauri commands and startup code should only delegate to that adapter.

### Frontend patterns

`LyricsStatus` from Rust serializes as `"Loading" | "Ready" | "NotFound"` (plain strings) or `{"Error": "..."}` (object). Compare with `=== 'Loading'` etc.

`RenderSnapshot` contains both `active_line_index` (used by the `app` view via `get_all_lyrics`) and `visible_lines` (used by `island` and `karaoke`). The `app` view fetches the full lyric array separately via `get_all_lyrics` and highlights by index; the other views use the pre-windowed `visible_lines` directly.

UI-layer state (window lock, position, font scale) flows through `ui-settings-changed` Tauri events. Playback state is only available by calling `get_render_snapshot`.

Frontend OS styling is selected through `body[data-os]`. Linux must be detected as `linux` instead of falling through to macOS styles; shared playback UI should stay platform-neutral and consume `RenderSnapshot`.
