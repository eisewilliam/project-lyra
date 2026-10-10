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
| `island` | `/island` | `views/island` | Dynamic Island-style mini overlay |
| `karaoke` | `/karaoke` | `views/karaoke` | Fullscreen karaoke overlay |
| `settings` | `/settings` | `views/settings` | Settings UI |

`island` and `karaoke` are macOS NSPanels (always-on-top, non-activating). See `src-tauri/src/macos.rs` for the Objective-C bridge. On Windows and Linux, the same helper functions fall back to regular Tauri window positioning and visibility APIs.

### Rust state in `AppState`

`lib.rs` manages one `AppState` registered with Tauri:

```rust
AppState {
    runtime: Mutex<LyraRuntime>,   // core playback, lyrics, settings, offsets
    lyrics: LyricsRefresh,        // core HTTP client + in-flight fetch claims
    players: Arc<PlayerHub>,       // core player adapters + session registry
    ui: UiStateStore,              // host window preferences
    surface_visibility: RuntimeSurfaceVisibility, // transient host visibility
}
```

`LyraRuntime` lives in `crates/lyra-core/src/runtime.rs`. The host injects its application-support directory through `new_in`; core does not select an OS directory or depend on Tauri. `LyricsRefresh` owns cache eligibility, request deduplication, and result classification. Its runtime lock never spans the network await. Disk cache reads and settings/offset writes can still happen under the runtime lock; cache-result writes are scheduled separately.

### Playback delivery

The host poll driver calls `PlayerHub::poll()`, which queries every platform adapter and lets the session registry choose the followed session. macOS uses a GCD leeway timer; Windows and Linux use the generic sleep loop. Adapter calls run outside the runtime Mutex. Playback commands (`playback_*`) are async and call `PlayerHub::control()` on the blocking pool; they return an error when no session is followed or the session does not support the control. Cadence follows the configured interval (clamped to 100–2000 ms), backs off for paused/stopped/missing-lyrics states, and skips adapter calls while all playback surfaces are hidden. Earlier wakeups can target the next lyric transition without polling the adapter again.

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

Frontend OS styling is selected through `body[data-os]`. Linux must be detected as `linux` instead of falling through to macOS styles; shared playback UI should stay platform-neutral and consume `RenderSnapshot`.
