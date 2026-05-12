# Lyra

A free, cross-platform, floating synced-lyrics companion for your desktop.

Lyra displays time-synchronized lyrics for the currently playing track in a beautiful always-on-top window. Built first for macOS + Spotify, architected from day one to support Apple Music, Windows, Linux, and eventually mobile — by writing new adapters, not rewriting the core.

> **Status:** Phase 1 — active development. Not yet usable as a daily driver.

---

## Why Lyra?

| | LyricsX | Vibe / Dynamic-Lyrics | Lyra |
|---|---|---|---|
| Free | ✓ | ✗ | ✓ |
| Actively maintained | ✗ | ✓ | ✓ |
| Cross-platform | Partial | ✗ (macOS only) | ✓ (planned) |
| Open architecture | ✗ | ✗ | ✓ |
| No account required | ✓ | ✗ | ✓ |

---

## Features

### Now (Phase 1 MVP)
- Floating always-on-top lyrics window
- Time-synced lyrics via [LRCLIB](https://lrclib.net) — free, no auth
- Spotify integration on macOS via AppleScript
- Flat-file lyrics cache — works offline after first fetch
- Manual LRC override per track

### Soon (Phase 2)
- Karaoke word-highlight mode
- Settings UI — font, color, opacity, context lines
- Glass aesthetic, smooth scroll animation

### Later (Phase 3+)
- Dynamic Island / notch-adjacent window (Swift sidecar)
- macOS widget
- Apple Music adapter
- Windows (SMTC) and Linux (MPRIS) support

---

## Architecture

```
┌─────────────────────────────────────────┐
│         Desktop Host Layer              │
│   Tauri 2 window + React/TypeScript UI  │
└──────────────────┬──────────────────────┘
                   │ Tauri commands / events
                   ▼
┌─────────────────────────────────────────┐
│         Lyra Core  (Rust library)       │
│  playback model · lyrics pipeline       │
│  sync engine · cache · config           │
└────────┬─────────────────┬─────────────┘
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌──────────────────┐
│  Spotify macOS  │  │  LRCLIB client   │
│  AppleScript    │  │  + local cache   │
└─────────────────┘  └──────────────────┘
```

The Rust core owns all behavior — playback state, lyric resolution, sync, caching. The desktop host renders state and forwards user intent. Adding a new player or lyric source means implementing one trait, not touching the core.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`docs/PRD.md`](docs/PRD.md) for product requirements.

For release planning, see [`docs/first-alpha-release.md`](docs/first-alpha-release.md).

---

## Repository Layout

```
apps/
  desktop-tauri/        # Tauri 2 host — Vite + React + TypeScript UI
    src/                # React frontend
    src-tauri/          # Rust Tauri bridge + command handlers

crates/
  lyra-core/            # Rust library: all shared logic
    src/
      domain.rs         # Core types (TrackRef, RenderSnapshot, …)
      player/           # PlayerAdapter trait + Spotify macOS adapter
      lyrics/           # LRC parser, LRCLIB client, flat-file cache
      sync.rs           # Line selection + karaoke progress engine
      config.rs         # Settings persistence
      events.rs         # PlayerEvent / CoreEvent types
  lyra-host-api/        # Deferred — shared host contract types (Phase 2)

docs/
  PRD.md
  ARCHITECTURE.md

native/                 # Deferred — Phase 3+
  macos-sidecar/        # Swift sidecar for Dynamic Island / widgets
  desktop-swift/        # Future full native macOS host
```

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | stable (≥ 1.77.2) | install via [rustup](https://rustup.rs) |
| Node.js | ≥ 18 | install via [fnm](https://github.com/Schniz/fnm) or nvm |
| npm | ≥ 9 | bundled with Node |
| Xcode Command Line Tools | latest | `xcode-select --install` |

### Build

```bash
# Clone
git clone https://github.com/your-username/lyra.git
cd lyra

# Install frontend dependencies
cd apps/desktop-tauri && npm install

# Run in development mode (opens Tauri window with hot reload)
npm run tauri dev

# Build release bundle
npm run tauri build
```

### Run tests

```bash
# From repo root (not apps/desktop-tauri)
cd lyra
cargo test -p lyra-core
```

---

## Configuration

Settings are stored at:

```
~/Library/Application Support/Lyra/config.json   # macOS
%APPDATA%\Lyra\config.json                        # Windows (future)
~/.local/share/Lyra/config.json                   # Linux (future)
```

### Lyrics cache

Fetched lyrics are cached as plain `.lrc` files:

```
~/Library/Application Support/Lyra/lyrics_cache/
```

### Manual override

Drop an LRC file in the overrides directory to override any track:

```
~/Library/Application Support/Lyra/lyrics_overrides/
```

Filename format: `{percent-encoded-track-uri}.lrc`  
Example: `spotify%3Atrack%3Aabc123.lrc`

---

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 — MVP | Rust core, LRCLIB, Spotify adapter, Tauri window | 🔨 In progress |
| 2 — Polish | Karaoke, visual design, settings UI | Planned |
| 3 — Native macOS | Dynamic Island, widget, Apple Music | Planned |
| 4 — Cross-platform | Windows SMTC, Linux MPRIS | Planned |
| 5 — Stretch | Touch Bar, word-level richsync, mobile | Stretch |

---

## Privacy

Lyra makes exactly one category of outbound request: lyric lookups to [LRCLIB](https://lrclib.net). No telemetry, no analytics, no accounts, no cloud sync.

---

## License

MIT — see [LICENSE](LICENSE).
