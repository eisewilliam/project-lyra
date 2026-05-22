# Lyra

Lyra is an early desktop synced-lyrics companion for Spotify on macOS and Windows. It follows the current track, finds synchronized lyrics, and renders them in lyric surfaces that can stay close to the work already on screen.

The current app is built with a Tauri desktop host and a Rust core. It is ready for early use and feedback, but the release path is still intentionally narrow: Spotify playback, LRCLIB-backed synced lyrics, and desktop overlays.

## Features

- Main Lyra window with album artwork, playback controls, seeking, the full lyric sheet, and current-line highlighting
- Floating island overlay for compact always-on-top lyrics
- Karaoke overlay with word-progress highlighting and configurable layout
- Settings for surface visibility, font scale, overlays, pause behavior, autostart, theme, and preferred monitor
- Spotify playback integration on macOS through AppleScript and on Windows through SMTC
- Synced lyric lookup through [LRCLIB](https://lrclib.net), local flat-file caching, explicit no-lyrics states, retry support, and manual LRC overrides
- Local-first behavior after lyrics are cached, with no Lyra account or telemetry

## Early Release Notes

Lyra is still early. The current release path focuses on Spotify playback on macOS and Windows. Lyrics depend on synced LRCLIB coverage unless a local LRC override is available.

Linux support, Apple Music support, signing and distribution polish, and additional native platform integrations are not part of this release yet.

## Surfaces

| Surface | Purpose |
|---|---|
| Lyra window | Full lyric sheet, track context, playback controls, and seekable lyrics |
| Floating island | Compact overlay with the active lyric context near the top of the screen or another chosen position |
| Karaoke overlay | Wide overlay for one or two active lyric lines with configurable position, alignment, width, and opacity |
| Settings | Visibility and appearance controls for the lyric surfaces plus app behavior settings |

## Getting Started

### Prerequisites

| Tool | Notes |
|---|---|
| Rust stable | Install with [rustup](https://rustup.rs) |
| Node.js 18 or newer | Used by the React/Vite frontend and Tauri CLI |
| npm | Bundled with Node.js |
| Platform build tools | Xcode Command Line Tools on macOS; Tauri prerequisites for Windows |
| Spotify desktop app | Lyra follows Spotify playback state from the host OS |

### Run locally

From the repository root:

```bash
cd apps/desktop-tauri
npm install
npm run tauri dev
```

### Build a desktop bundle

```bash
cd apps/desktop-tauri
npm run tauri build
```

### Verify the workspace

Run Rust commands from the repository root:

```bash
cargo test -p lyra-core
cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml
```

Run frontend lint from the desktop app directory:

```bash
cd apps/desktop-tauri
npm run lint
```

## Architecture

```text
React UI surfaces
    | Tauri commands and events
    v
Tauri Rust bridge
    | function calls
    v
lyra-core
    | OS playback adapters and network requests
    v
Spotify adapters + LRCLIB
```

`lyra-core` owns shared behavior: playback snapshots, lyric parsing and resolution, sync calculations, settings, and the lyric cache. The Tauri bridge delegates to the core. React surfaces render snapshots and forward user intent through commands and events.

That boundary is deliberate. Platform adapters and desktop surfaces can evolve without moving lyric logic into UI code.

## Repository Layout

```text
apps/
  desktop-tauri/        Tauri 2 desktop host and React/Vite UI
    src/                Four SPA surfaces: main, island, karaoke, settings
    src-tauri/          Rust Tauri bridge, tray integration, window state

crates/
  lyra-core/            Shared Rust playback, lyrics, sync, cache, and config logic

docs/
  PRODUCT.md            Current product overview
  PRD.md                Product requirements and longer-range direction
  ARCHITECTURE.md       Architecture background and design constraints
```

## Local Data

Lyra persists UI state separately from core settings and lyric files. The directory casing is currently different on macOS and remains a known implementation detail:

| Data | Managed by | macOS path |
|---|---|---|
| UI state | Tauri UI state store | `~/Library/Application Support/lyra/` |
| Settings | `lyra-core` config store | `~/Library/Application Support/Lyra/config.json` |
| Cached lyrics | `lyra-core` lyric cache | `~/Library/Application Support/Lyra/lyrics_cache/` |
| Manual lyric overrides | `lyra-core` lyric cache | `~/Library/Application Support/Lyra/lyrics_overrides/` |

Fetched lyrics are stored as `.lrc` files. A manual override wins over fetched cache content for the same track key.

Override filenames use the percent-encoded track key:

```text
spotify%3Atrack%3Aabc123.lrc
```

Windows uses the OS data directory selected by the app runtime for the equivalent Lyra data stores.

## Privacy

Lyra does not require an account and does not include telemetry or analytics. Its remote lyric lookups go to [LRCLIB](https://lrclib.net); playback state is read locally from Spotify through the active platform adapter.

## Roadmap

The near-term release work is about making the existing desktop experience reliable and distributable:

- Validate early builds and improve release packaging
- Improve lyric coverage behavior and manual override ergonomics
- Refine overlay behavior and settings based on real use
- Extend player and platform support after the current Spotify desktop path is stable

## License

MIT. See [LICENSE](LICENSE).
