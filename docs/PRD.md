# Lyra — Floating Synced Lyrics Companion
## Functional Product Requirements Document

| | |
|---|---|
| **Version** | 0.1 (Draft) |
| **Status** | Planning / Pre-Implementation |
| **Author** | Olusegun William Eise |
| **Last Updated** | 2026-05-11 |
| **Working Name** | Lyra *(placeholder — TBD)* |

---

## 1. Overview

Lyra is a personal, free, cross-platform synced-lyrics companion. It displays time-synchronized lyrics for the currently playing track in a beautiful floating window, with optional Marquee (dynamic panel), widget, and Touch Bar surfaces on macOS.

The product is built initially for personal use on macOS with Spotify, but is architected from day one to support Apple Music, Windows, Linux, and eventually mobile platforms — by writing new adapters, not by rewriting the core.

It is inspired by Vibe Dynamic Lyrics and Dynamic-Lyrics on the Mac App Store, with three differentiators: it is **free**, **architecturally open**, and **not locked to a single OS or player**.

## 2. Problem Statement

Existing lyrics widgets on macOS fall into three buckets:

1. **Free and aging** (LyricsX) — functional, lightweight, but visually dated and slow to evolve.
2. **Paid and polished** (Vibe, Dynamic-Lyrics) — beautiful and modern, but locked to macOS, single-purpose, expensive, and not extensible.
3. **Player-locked** (Musixmatch desktop app, Spicetify extensions) — tied to a single ecosystem and often poorly maintained outside it.

No option exists that is simultaneously free, beautifully designed, cross-platform, and player-agnostic. Lyra fills that gap as a personal-tool-first project that can be opened to others later.

## 3. Goals & Non-Goals

### 3.1 Goals

- Display time-synced lyrics for the currently playing Spotify track on macOS within **300 ms** of any state change.
- Provide a floating window that looks native and modern — visually comparable to Vibe's "liquid glass" aesthetic.
- Be free with no required accounts, sign-in, or paid services.
- Architect the system so adding Apple Music, Windows, Linux, or mobile support is a matter of writing one adapter, not rewriting the core.
- Be CPU- and memory-light enough to run continuously without measurably affecting battery life.

### 3.2 Non-Goals

- Music playback or library management — Lyra is a *display layer* over existing players.
- Cloud account sync, social sharing, or user-generated content.
- Reverse-engineering proprietary lyrics APIs (Musixmatch richsync, Apple TTML, Spotify internal endpoints).
- Monetization. This is a personal project; commercialization is a future decision, not a v1 goal.
- iOS floating overlays. iOS does not permit cross-app overlays — see §6.11.

## 4. Target Users

- **Primary (Phases 1–3):** William himself. Success bar: *"Would I use this every day instead of LyricsX?"*
- **Secondary (Phase 4+):** Power users who want a free, customizable, cross-platform alternative to Vibe and Dynamic-Lyrics.
- **Tertiary:** Linux users running Spotify — currently the most underserved segment for synced-lyrics widgets.

## 5. Product Principles

1. **Free, no auth.** Anyone should be able to install and run without logging in or paying.
2. **Privacy by default.** No telemetry, no analytics, no phoning home. Lyric requests go directly to providers.
3. **Native feel per platform.** A shared codebase covers the lyrics layer; the *window* should feel right on each OS.
4. **Open architecture.** Players, lyric sources, and UI surfaces are all pluggable.
5. **Personal-tool standards.** Ship the smallest useful thing, then iterate. Resist scope creep until phase 1 actually runs.

## 6. Functional Requirements

Priority: **P0** = MVP, must ship • **P1** = first follow-up • **P2** = nice to have • **P3** = stretch / optional

### 6.1 Floating Lyrics Window — P0

- Always-on-top, transparent, borderless window.
- Resizable and repositionable; position and size persist across launches.
- Shows current line with N lines of context above and below (configurable, default 1/1).
- Auto-scrolls smoothly as playback advances.
- Hides automatically when no music plays (configurable).
- Click-through mode toggleable via global hotkey, so the window doesn't intercept clicks.
- Font family, size, color, opacity, and background style configurable in settings.

### 6.2 Spotify Integration (macOS) — P0

- Polls Spotify via AppleScript every ~300 ms.
- Captures: track URI, title, artist, album, duration, player state, position.
- Detects track changes, scrubbing, pausing, and stopping correctly.
- Idle CPU impact under 1% on M-series Macs.

### 6.3 Lyrics Fetching & Caching — P0

- Primary source: **LRCLIB** (free, open, no auth required).
- Cache keyed by Spotify track URI — first lookup hits the network, every replay is local.
- Cache stored as flat LRC files; human-inspectable and easily backed up.
- Graceful "no lyrics found" UI state when LRCLIB returns nothing.
- Manual lyric override: user can drop an LRC file for any track URI.

### 6.4 Karaoke Mode — P1

- Per-word highlighting via character-position interpolation within each line (using line start and end timestamps).
- Smooth fill / color-transition animation as the playhead advances.
- Toggleable; line-level mode remains the default for users who find karaoke distracting.
- Designed to plug in true word-level timing later if a clean source becomes available.

### 6.5 Marquee: Dynamic Panel (macOS) — P1

- Floating panel the user places wherever they like: against any edge, floating over their work, or beside other windows. Never assume a top-docked or notch placement.
- Sized in points as one design at a chosen scale, matched to each display by default; when placed under a MacBook notch, its content clears the notch.
- Two states: **compact** (scrolling artist + track) and **expanded** (current line).
- Spring-animated transitions on hover.
- Click-through everywhere except the active region.
- Implemented as a **Swift sidecar process** talking to the Rust core over IPC.

### 6.6 macOS Widget — P2

- Notification Center / Desktop widget showing currently playing track and current line.
- Built with WidgetKit / SwiftUI in a separate widget extension target.
- Updates as frequently as WidgetKit allows (system-controlled, typically every few seconds when active).
- Tap to bring the main floating window to the foreground.

### 6.7 Touch Bar Support — P3 (Optional)

- Strip showing artist, track, and current line on supported MacBook Pros.
- Tap to seek where the player adapter supports it.
- Deprioritized due to Apple's discontinuation of Touch Bar hardware; build only if William personally uses a Touch Bar machine.

### 6.8 Apple Music Adapter — P2 (Future)

- AppleScript bridge to Music.app, mirroring the Spotify adapter.
- Same `PlayerAdapter` trait, so no core changes needed.
- Lyrics still sourced from LRCLIB unless the user opts into MusicKit credentials (separate, paid Apple developer path — not implemented in v1).

### 6.9 Windows Support — P3 (Future)

- Adapter using **SMTC** (System Media Transport Controls) — works with Spotify, Apple Music for Windows, browser playback, and any SMTC-aware player.
- Tauri shell builds for Windows out of the box.
- No notch-integrated Marquee or WidgetKit equivalents — desktop floating window only.

### 6.10 Linux Support — P3 (Future)

- Adapter using **MPRIS** over D-Bus — works with Spotify, Strawberry, VLC, Rhythmbox, and most Linux media players.
- Tauri shell builds for Linux out of the box.
- This is arguably the highest-impact platform addition given how underserved Linux is for synced lyrics.

### 6.11 Mobile — Stretch, Not Committed

- **iOS:** Live Activity + Lock Screen widget. No floating overlay is possible on iOS due to platform restrictions.
- **Android:** Floating overlay using the `SYSTEM_ALERT_WINDOW` permission.
- Both require separate native apps; they would share the Rust core via cross-compilation, not the Tauri shell.

## 7. Non-Functional Requirements

| Category | Target |
|---|---|
| Idle CPU | < 1% on M-series Macs |
| Memory | < 100 MB resident |
| Sync latency | < 100 ms between expected and displayed line |
| App launch | Main window visible < 500 ms after launch |
| Bundle size | < 20 MB for Tauri build (excluding Swift sidecar) |
| Privacy | No telemetry, no analytics, no cloud sync |
| Reliability | Survives Spotify quitting and network loss (uses cache) |
| Updates | Optional Tauri auto-updater; opt-in only |

## 8. Technical Architecture

### 8.1 Component Overview

```
┌─────────────────────────────────────────────┐
│         Lyra Core (Rust library)            │
│  • LRCLIB client                            │
│  • LRC parser                               │
│  • Sync engine                              │
│  • Lyrics cache (flat-file LRC store)       │
│  • PlayerAdapter trait                      │
└──────────────┬──────────────────────────────┘
               │
   ┌───────────┼───────────┬──────────────┐
   ▼           ▼           ▼              ▼
┌────────┐ ┌────────┐ ┌────────┐   ┌────────────┐
│ macOS  │ │macOS AM│ │Windows │   │   Linux    │
│Spotify │ │AppleScr│ │ SMTC   │   │   MPRIS    │
│AppleScr│ │ipt     │ │        │   │  (D-Bus)   │
└────────┘ └────────┘ └────────┘   └────────────┘

┌─────────────────────────────────────────────┐
│            UI Surfaces                       │
│  • Tauri main window (mac / Win / Linux)    │
│  • Swift sidecar (macOS only):              │
│      Marquee • Widget • Touch Bar           │
└─────────────────────────────────────────────┘
```

### 8.2 The Player Adapter Trait

All player adapters implement one interface. Adding a new player or platform = implementing this trait and registering the adapter.

```rust
trait PlayerAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn current_track(&self) -> Option<TrackInfo>;
    fn position_ms(&self) -> Option<u64>;
    fn state(&self) -> PlaybackState;
    fn subscribe(&self, callback: Box<dyn Fn(PlayerEvent) + Send>);
}

struct TrackInfo {
    uri: String,         // canonical ID per player
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: u64,
}

enum PlaybackState { Playing, Paused, Stopped }

enum PlayerEvent {
    TrackChanged(TrackInfo),
    StateChanged(PlaybackState),
    PositionJumped(u64),
}
```

### 8.3 IPC Between Rust Core and Swift Sidecar (macOS)

- Unix domain socket at `~/Library/Application Support/Lyra/ipc.sock`.
- Newline-delimited JSON protocol.
- Bidirectional: core pushes track and lyric updates; sidecar requests current state on resume.
- Simple by design — text protocol, easy to debug with `nc`.

### 8.4 Data Storage

- **Lyrics cache:** `~/Library/Application Support/Lyra/lyrics_cache/{track_uri}.lrc`
- **Settings:** `~/Library/Application Support/Lyra/config.json`
- **No database in v1.** Flat files are sufficient and trivially debuggable. SQLite stays on the table for v2 if cache size becomes a concern.

## 9. Dependencies & Data Sources

| Dependency | Purpose | Risk Level | Mitigation |
|---|---|---|---|
| LRCLIB.net | Primary lyrics source | Medium — single point of failure | Local cache; manual LRC override; pluggable source interface |
| Spotify AppleScript | macOS playback state | Low — long-maintained interface | None needed |
| Tauri 2 | Desktop shell | Low | Active project, large community |
| SwiftUI / WidgetKit | macOS native surfaces | Low | First-party Apple frameworks |
| MPRIS / D-Bus | Linux playback state | Low | Industry standard |
| SMTC | Windows playback state | Low | First-party Microsoft API |

## 10. Phased Roadmap

### Phase 1 — Working MVP — Weekend 1 *(~10–15h)*

- Rust core, LRCLIB client, LRC parser.
- Spotify AppleScript adapter.
- Tauri main window with line-level sync.

**Exit criteria:** Lyra displays the correct line for any Spotify track that exists in LRCLIB.

### Phase 2 — Polish — Weekends 2–3 *(~20–30h)*

- Karaoke interpolation.
- Visual design pass (glass aesthetic, smooth scroll, font controls).
- Settings UI, caching, offline support, manual lyric override.

**Exit criteria:** Lyra is something William uses daily instead of LyricsX.

### Phase 3 — Native macOS Surfaces — Weekends 4–6

- Swift sidecar scaffolding + IPC.
- Marquee window.
- macOS widget (if motivation holds).
- Apple Music adapter (free win once architecture is in place).

**Exit criteria:** Notch widget feels production-quality.

### Phase 4 — Cross-Platform Desktop — Weekends 7–8

- Windows SMTC adapter.
- Linux MPRIS adapter.
- Per-platform packaging and signing.

**Exit criteria:** The same Tauri build runs on all three desktop OSs with appropriate player adapters.

### Phase 5 — Optional / Stretch

- Touch Bar.
- Word-level richsync (if a clean, legal source emerges).
- Mobile apps (iOS Live Activity, Android floating overlay).
- Public release: name, license, signing, distribution (Homebrew cask, App Store, .deb/.AppImage, etc.).

## 11. Success Metrics

This being a personal tool, qualitative metrics matter most:

1. Does William use Lyra daily for at least one month after Phase 2?
2. Is the floating window something he's happy to leave on a second monitor all day?
3. When a friend sees it on his screen, do they ask what it is?

Quantitative metrics:

- Sync accuracy: < 100 ms drift between expected and displayed line.
- Lyric coverage: ≥ 85% of personal listening library has matching LRC in LRCLIB.
- Idle CPU: < 1% on M-series Macs.

## 12. Risks & Open Questions

### Risks

- **LRCLIB coverage gap.** Non-English or very new releases may have no synced lyrics. *Mitigation:* manual LRC override; long-term, accept user-contributed files.
- **Spotify ToS.** AppleScript usage is fully sanctioned. If the project is ever published, audit to ensure no unofficial endpoints sneak into the codebase.
- **WidgetKit constraints.** Apple controls widget update frequency. The macOS widget will feel less live than the floating window. Acceptable trade-off.
- **Touch Bar attrition.** Building for deprecated hardware is sunk cost. Build only if personally used.
- **Rust learning curve.** William has Go familiarity but not Rust. Most application logic can live in the TypeScript frontend via Tauri commands; the Rust surface area is intentionally kept small (player adapters, LRC parsing, caching).

### Open Questions

- Final product name (Lyra is a placeholder).
- Cache backend: flat-file vs SQLite. Flat-file for v1; revisit if library exceeds ~10k tracks.
- Swift sidecar: separate target or bundled with the main app?
- License: MIT vs GPL vs source-available, if and when this is opened to others.
- Should the cache sync via iCloud Drive across William's devices? Probably no for v1.

## 13. Appendix

### 13.1 Glossary

| Term | Meaning |
|---|---|
| **LRC** | Lyric file format with `[mm:ss.xx]` timestamps per line. |
| **MPRIS** | Media Player Remote Interfacing Specification — Linux D-Bus standard. |
| **SMTC** | System Media Transport Controls — Windows now-playing API. |
| **WidgetKit** | Apple's SwiftUI-based widget framework. |
| **AppleScript** | Apple's macOS automation language; Spotify and Music.app both expose scripting dictionaries. |
| **IPC** | Inter-process communication. |

### 13.2 Inspirations & Prior Art

- Vibe Dynamic Lyrics (Mac App Store)
- Dynamic-Lyrics (Mac App Store)
- LyricsX (open source, GitHub: ddddxxx/LyricsX) — best reference implementation in Swift
- NotchNook / DynamicNotch — for the notch pattern
- Spicetify Lyrics Plus — for word-level timing approaches

### 13.3 Tech Stack vs. Author Familiarity

| Layer | Technology | William's Familiarity |
|---|---|---|
| Core library | Rust | New — learning curve, kept small |
| Desktop shell | Tauri 2 | Tauri new, but underlying TS/React is core skill |
| Frontend UI | React + TypeScript | Strong |
| macOS native | Swift / SwiftUI | New |
| Lyrics API | LRCLIB REST | Strong (API consumption is daily work) |
| Build / CI | GitHub Actions | Strong |
| Packaging / signing | Tauri bundler, notarytool, codesign | New on macOS |

---

*End of document.*