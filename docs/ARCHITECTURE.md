# Lyra Architecture Document

| | |
|---|---|
| Version | 0.1 (Draft) |
| Status | Planning / Pre-Implementation |
| Based on | docs/PRD.md |
| Last Updated | 2026-05-11 |

---

## 1. Purpose

This document translates the product requirements in the PRD into an implementation-facing system architecture for Lyra.

It answers four practical questions:

1. What are the core runtime components?
2. How do those components communicate?
3. Where do platform-specific concerns stop and shared logic begin?
4. What should be built first so v1 stays small and extensible?

This is not a UI spec and not a roadmap replacement. It is the technical blueprint for building the first working system without painting the project into a corner.

## 2. Architectural Goals

The architecture must preserve these product constraints:

- One shared lyrics engine across desktop platforms.
- Platform support added by adapters, not rewrites.
- UI host technology replaceable without rewriting core behavior.
- Fast enough to react to playback changes within roughly 300 ms.
- Small enough to run continuously with very low CPU and memory use.
- Local-first and privacy-preserving: no telemetry, no required accounts, no cloud dependency.
- Simple enough for an initial implementation by one developer learning parts of the stack.

## 3. Scope

### In scope for v1

- macOS Spotify support via AppleScript.
- An initial desktop host implemented with Tauri and a floating lyrics window.
- Rust core library for playback modeling, lyric retrieval, caching, parsing, and sync.
- LRCLIB as the only remote lyric source.
- Flat-file config and cache.

### Explicitly out of scope for v1

- Native playback control beyond what is required for display.
- Proprietary or unofficial lyrics APIs.
- WidgetKit, Dynamic Island, Touch Bar, Windows, Linux, and mobile implementations.
- Cloud sync, analytics, user accounts, or background services.

## 4. High-Level Design

Lyra is a layered desktop application with a shared Rust core, a replaceable desktop host layer, and optional native sidecars for platform-specific surfaces.

```text
+--------------------------------------------------------------+
| Desktop Host Layer                                           |
| Initial host: Tauri window + React/TypeScript UI             |
| Future host: SwiftUI/AppKit or other native counterpart      |
+--------------------------+-----------------------------------+
                           |
                           | host bridge / state channel
                           v
+--------------------------------------------------------------+
| Lyra Core (Rust library)                                     |
| playback model | lyrics pipeline | sync engine | config      |
| cache | event bus | provider and adapter interfaces          |
+-------------+----------------------+-------------------------+
              |                      |
              | player adapter       | lyric source
              v                      v
+-------------------------+   +-------------------------------+
| Spotify adapter (macOS) |   | LRCLIB HTTP client            |
| AppleScript polling     |   | local cache + manual override |
+-------------------------+   +-------------------------------+

Optional later:
- Swift sidecar for Dynamic Island / widget-adjacent macOS surfaces
- Full native desktop host replacing Tauri while reusing the same core API
- Windows SMTC adapter
- Linux MPRIS adapter
```

The controlling rule is simple:

- Shared logic belongs in the Rust core.
- Windowing and visual presentation belong in the host layer.
- Platform-only capabilities belong in adapters or sidecars.
- The host layer must depend on a stable core API rather than on internal core modules.

## 5. Architecture Principles

### 5.1 Core owns behavior

The Rust core owns playback state normalization, lyric selection, cache policy, sync calculations, and event generation. UI layers should render state, not compute it.

### 5.2 Adapters isolate platform APIs

Spotify AppleScript, Windows SMTC, Linux MPRIS, and future Apple Music support all sit behind the same internal contract. Platform code should translate native signals into shared domain events.

### 5.3 UI surfaces are consumers of state

The main Tauri window and any future Swift sidecar should subscribe to state snapshots and render them. They should not independently query players or lyric providers.

### 5.4 Local-first storage

The system must remain useful with no network after a lyric has been cached once. Cache and configuration formats should remain readable and easy to inspect.

### 5.5 Prefer simple data movement

For v1, communication paths should use plain JSON payloads, newline-delimited IPC, and file-backed persistence. Complexity should only be introduced once scale or platform constraints force it.

### 5.6 Host replacement must be cheap

Tauri is an implementation choice for v1, not a permanent architectural dependency. Replacing the desktop host with Swift, AppKit, SwiftUI, WinUI, or another native stack should require a new host implementation, not a rewrite of playback, caching, sync, or provider logic.

That implies three constraints:

- The core must expose host-agnostic commands and snapshots.
- TypeScript UI code must not become the home of business rules.
- Settings, render state, and user intents must cross the host boundary through stable serialized contracts.

## 6. Runtime Components

## 6.1 Desktop Host

Responsibilities:

- Create and manage the floating lyrics window.
- Persist and apply window geometry and presentation settings.
- Render current, previous, and next lyric lines.
- Expose settings UI and manual override affordances.
- Subscribe to state updates emitted by the core.
- Forward user intents such as click-through toggle, settings changes, and override import requests.

Non-responsibilities:

- Polling Spotify directly.
- Parsing LRC files.
- Computing the active lyric line.
- Implementing platform-specific media integrations.

Initial implementation:

- Tauri host with React/TypeScript view layer.

Future implementations:

- Native SwiftUI/AppKit host on macOS.
- WinUI, WPF, or other native Windows host.
- GTK, Qt, or another Linux-native host if desired.

The architecture should assume there may eventually be more than one host implementation over the same core.

## 6.2 Lyra Core (Rust)

The core is the system boundary that all surfaces talk to.

Submodules:

- `playback`: normalized track and playback state model.
- `player`: platform adapters and adapter registry.
- `lyrics`: source client, parser, cache, override resolution.
- `sync`: line selection, drift handling, karaoke interpolation.
- `config`: settings model and persistence.
- `events`: pub/sub or broadcast channel for UI consumers.
- `ipc`: sidecar protocol support for later macOS native surfaces.

The core should expose a small API to the host:

- start runtime
- get current snapshot
- subscribe to updates
- update settings
- import manual override
- request lyric refresh for current track

That API should be defined in terms of serializable request and response types so the same contract can be consumed by Tauri commands today and by a native host bridge later.

## 6.3 Host Bridge Contract

Between the core and any host, Lyra should define a narrow host bridge contract.

Host-to-core intents:

- start runtime
- subscribe to render state
- update settings
- set click-through mode
- import manual override
- request lyric refresh

Core-to-host outputs:

- playback snapshot
- render snapshot
- lyrics status changes
- settings snapshot
- recoverable error events

This contract is more important than the host implementation. If it remains stable, switching from Tauri to Swift later becomes an integration project rather than an application rewrite.

## 6.4 Player Adapter Layer

Player adapters translate platform-native playback information into shared state.

Initial adapter:

- `SpotifyMacOsAppleScriptAdapter`

Future adapters:

- `AppleMusicMacOsAppleScriptAdapter`
- `WindowsSmtcAdapter`
- `LinuxMprisAdapter`

Shared responsibilities:

- Identify current track.
- Read playback state and position.
- Detect track changes, pauses, resumes, stops, and scrubs.
- Emit normalized events without leaking platform details upward.

## 6.5 Lyrics Pipeline

The lyrics pipeline resolves a track into a `LyricDocument` using a deterministic lookup order:

1. Manual override on disk.
2. Local cache.
3. LRCLIB network lookup.
4. Negative cache or "no lyrics found" result.

This ordering ensures the system remains predictable and offline-friendly.

## 6.6 Sync Engine

The sync engine consumes the active playback snapshot and the current lyric document, then computes renderable lyric state:

- active line index
- previous and next context lines
- progress within the current line
- karaoke fill fraction when enabled
- no-lyrics, loading, paused, and stopped display states

The sync engine should be deterministic and free of UI concerns so it can be tested independently.

## 6.7 Swift Sidecar (Later)

The Swift sidecar is deferred until Phase 3, but the architecture should reserve for it now.

Responsibilities later:

- Render Dynamic Island-like or notch-adjacent surface.
- Render widget-adjacent or other native macOS surfaces where Tauri is a poor fit.
- Receive state from the Rust core over IPC.

The sidecar must not reimplement lyric fetching or playback integration.

## 7. Domain Model

The runtime should center around a few stable domain types.

```rust
struct TrackRef {
    source: PlayerSource,
    uri: String,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: u64,
}

enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

struct PlaybackSnapshot {
    track: Option<TrackRef>,
    state: PlaybackState,
    position_ms: Option<u64>,
    observed_at_ms: u64,
}

struct LyricLine {
    start_ms: u64,
    end_ms: Option<u64>,
    text: String,
}

struct LyricDocument {
    track_key: String,
    source: LyricSourceKind,
    lines: Vec<LyricLine>,
    raw_lrc: String,
}

struct RenderSnapshot {
    playback: PlaybackSnapshot,
    lyrics_status: LyricsStatus,
    active_line_index: Option<usize>,
    line_progress: Option<f32>,
    visible_lines: Vec<VisibleLine>,
}

struct SettingsSnapshot {
  window: WindowSettings,
  appearance: AppearanceSettings,
  behavior: BehaviorSettings,
}

enum UiIntent {
  SetClickThrough(bool),
  UpdateSettings(SettingsPatch),
  RefreshLyrics,
  ImportOverride { track_key: String, file_path: String },
}
```

These are not final code definitions, but they show the intended seam: playback, lyrics, and rendering state remain distinct.

They also show the host boundary: hosts send `UiIntent` messages and consume snapshots. They do not reach into core internals.

## 8. Component Interactions

## 8.1 App Startup

```text
Desktop app starts
-> load config
-> initialize core runtime
-> register Spotify macOS adapter
-> host subscribes to render snapshots
-> start adapter polling loop
-> show floating window
```

## 8.2 Track Change Flow

```text
Spotify adapter detects new track
-> emit TrackChanged event
-> core updates PlaybackSnapshot
-> lyrics pipeline resolves lyric document
-> sync engine computes new RenderSnapshot
-> active host re-renders visible lines
-> optional sidecar receives same update later via IPC
```

## 8.3 Playback Tick Flow

```text
poll adapter every ~300 ms
-> read current state + position
-> synthesize state jump if scrub or pause/resume detected
-> update PlaybackSnapshot
-> recompute active lyric line
-> emit RenderSnapshot only if visible output changed
```

That last step matters for performance. The UI should not re-render on every poll if nothing visible changed.

## 9. Data Flow and State Ownership

Lyra should use a single-writer model for playback and lyric state.

- The player adapter is the only writer of raw playback observations.
- The lyrics pipeline is the only writer of lyric documents.
- The sync engine is the only writer of render snapshots.
- Hosts and UI surfaces are read-mostly consumers.

This avoids a class of bugs where UI state drifts from playback state because multiple layers compute line selection independently.

## 10. Adapter Contracts

The PRD already proposes a `PlayerAdapter` trait. The architecture keeps that shape and adds one more internal seam for lyric providers.

```rust
trait PlayerAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn snapshot(&self) -> Option<PlaybackSnapshot>;
    fn poll(&self) -> Option<PlayerEvent>;
}

trait LyricSource: Send + Sync {
    fn name(&self) -> &str;
    async fn fetch(&self, track: &TrackRef) -> Result<Option<LyricDocument>, LyricError>;
}
```

Notes:

- `snapshot()` gives the latest normalized state.
- `poll()` fits the initial AppleScript strategy and can later be backed by event-driven systems.
- `LyricSource` keeps LRCLIB replaceable without touching the cache or sync engine.

## 11. Polling, Timing, and Sync Strategy

The v1 adapter polls Spotify every roughly 300 ms. That cadence is acceptable if the rest of the pipeline is lightweight and the system avoids expensive work on each tick.

Recommended approach:

- Poll player state on a fixed interval.
- Compare current snapshot against previous snapshot.
- Classify changes as one of: no-op, position advance, state change, track change, position jump.
- Trigger lyric resolution only on track change.
- Trigger full render recompute only when visible output changes.

Scrub detection:

- If the observed position delta differs materially from elapsed wall-clock time, emit `PositionJumped`.
- Use a tolerance window so normal polling jitter does not look like a seek.

Display timing:

- Lyric line selection should prefer exact timestamp comparison over animation-driven heuristics.
- Smooth scrolling should be a presentation detail layered on top of deterministic line selection.

## 12. Lyrics Retrieval and Caching

## 12.1 Lookup order

For a given track:

1. Resolve a stable cache key from the canonical track URI.
2. Check for a manual override file first.
3. Check cache for an existing `.lrc` file.
4. If absent, call LRCLIB.
5. Persist successful results as `.lrc`.
6. Persist a short-lived negative cache entry for misses to avoid hammering LRCLIB.

## 12.2 Cache key strategy

The PRD requires cache keys to be based on track URI. The implementation should not use raw URIs directly as filenames because they may contain path-unsafe characters.

Recommended strategy:

- Keep the track URI as the logical cache key.
- Store files with a percent-encoded or URL-safe base64 filename.
- Optionally write a small adjacent metadata file if later debugging needs the original URI without decoding.

Example:

```text
~/Library/Application Support/Lyra/lyrics_cache/
  spotify%3Atrack%3Aabc123.lrc
  spotify%3Atrack%3Aabc123.meta.json
```

## 12.3 Manual overrides

Manual overrides should live in a separate directory from fetched cache entries so user-authored files are never overwritten by network refreshes.

Recommended paths:

- `lyrics_cache/` for fetched files
- `lyrics_overrides/` for user-supplied files

## 13. Configuration and Persistence

The application should use a single JSON settings file for v1.

Suggested settings domains:

- window geometry
- always-on-top behavior
- click-through enabled state
- hide-when-idle behavior
- typography and color settings
- context line count
- karaoke mode enabled state
- selected player adapter

Suggested path:

```text
~/Library/Application Support/Lyra/config.json
```

Write policy:

- Load once at startup.
- Update in memory on change.
- Persist with debouncing to avoid writing on every slider adjustment.

## 14. IPC Design for Native macOS Surfaces

Even though the Swift sidecar is a later phase, the protocol should be simple from day one.

Transport:

- Unix domain socket
- newline-delimited JSON messages

Core-to-sidecar message types:

- `hello`
- `playback_snapshot`
- `render_snapshot`
- `settings_updated`

Sidecar-to-core message types:

- `subscribe`
- `request_snapshot`
- `set_surface_state`

Example:

```json
{"type":"render_snapshot","payload":{"track":"spotify:track:abc123","line":"Hello, it's me","progress":0.42}}
```

Protocol rules:

- Messages should be additive and version-tolerant.
- The sidecar must be able to reconnect and request the latest snapshot.
- The core remains the source of truth.

The same message design principle should apply to any future full native host bridge.

## 15. Error Handling and Resilience

The system should fail soft, not fail closed.

Expected failure modes and behavior:

- Spotify not running: show idle or hidden state, keep polling at a reduced cost.
- Spotify quits mid-session: transition to stopped state without crashing.
- LRCLIB unavailable: use cached lyrics if present, otherwise show no-lyrics state.
- Invalid LRC file: reject parse, log locally, and surface a recoverable no-lyrics state.
- Corrupt config: fall back to defaults and preserve the bad file if possible for inspection.
- Sidecar missing or disconnected: main app continues unaffected.

The architecture should treat every external dependency as optional at runtime, even when it is required for the ideal experience.

## 16. Security and Privacy

Privacy requirements are simple and strict:

- No analytics.
- No telemetry.
- No remote config.
- No account system.

Security posture for v1:

- Only talk to the configured lyric provider.
- Only execute known AppleScript commands bundled with the app.
- Treat imported LRC files as untrusted input and parse defensively.
- Keep IPC bound to a user-local socket path under app support.

## 17. Performance Strategy

To stay within the PRD's CPU, memory, and latency targets, the implementation should optimize for doing less work rather than doing work faster.

Primary strategies:

- Keep AppleScript payloads minimal.
- Poll at a fixed cadence and avoid nested polling.
- Cache parsed lyric documents in memory for the current track.
- Emit UI updates only when visible output changes.
- Debounce config writes.
- Avoid expensive host-layer churn by pushing already-normalized render snapshots.

## 18. Testing Strategy

The architecture should support testing by isolating pure logic from OS integrations.

Test layers:

- Unit tests for LRC parsing.
- Unit tests for sync engine line selection.
- Unit tests for cache key generation and path handling.
- Fixture-driven tests for LRCLIB response mapping.
- Adapter contract tests with recorded AppleScript outputs where practical.
- Manual end-to-end checks on macOS for timing, click-through, and window behavior.

The highest-value automated tests are in the pure Rust core, not any particular host implementation.

## 19. Suggested Repository Layout

The project should start with a structure that is small but leaves room for new platforms.

```text
docs/
  PRD.md
  ARCHITECTURE.md

apps/
  desktop-tauri/
    src/              # React/TypeScript UI
    src-tauri/        # Tauri host and command bridge

crates/
  lyra-core/          # Rust library: playback, lyrics, sync, config
  lyra-host-api/      # Optional shared contract crate for host-facing types

native/
  macos-sidecar/      # Deferred until Phase 3
  desktop-swift/      # Deferred future native macOS host
```

This keeps shared logic in one place without forcing premature monorepo complexity, and it leaves a clear slot for a future host replacement instead of baking Tauri into the repository shape.

## 20. Implementation Plan by Architecture Slice

### Phase 1: MVP slice

Build these in order:

1. `lyra-core` domain types and config model.
2. Host-facing request/response types.
3. LRC parser and sync engine.
4. LRCLIB client and cache.
5. Spotify macOS AppleScript adapter.
6. Tauri bridge and floating window UI.

### Phase 2: Polish slice

- Karaoke interpolation.
- Settings persistence UX.
- Manual override flow.
- Visual polish and render smoothing.

### Phase 3 and later

- IPC server in core.
- Swift sidecar.
- Additional player adapters.
- Windows and Linux packaging.

## 21. Key Decisions

These are the main architecture decisions locked in by this document:

- Rust core is the system source of truth.
- Tauri is the initial desktop host, not a permanent UI dependency.
- Host-facing contracts must remain serializable and host-agnostic.
- macOS Spotify support starts as polling, not event-driven automation.
- LRCLIB is the only lyric provider in v1.
- Cache and config remain flat-file based in v1.
- Native macOS surfaces are sidecars, not responsibilities of the Tauri UI.
- New platform support must enter through adapters, not forks of core logic.

## 22. Deferred Decisions

These items remain intentionally open:

- Whether the initial Tauri host should call `lyra-core` directly or through a dedicated host API crate boundary.
- Whether negative cache entries should be timestamped JSON or a simple sentinel file.
- Whether future full native hosts should embed the Rust core directly or talk to a local runtime process.
- Whether the Swift sidecar ships as a bundled executable or separate target artifact.
- Whether SQLite becomes necessary once cache volume or metadata complexity grows.

## 23. Exit Criteria for This Architecture

The architecture is successful when the following are true:

- A new player integration can be added without changing lyric parsing or sync logic.
- A new UI surface can subscribe to existing state without querying players itself.
- The desktop host can be replaced without moving business logic out of Rust.
- Lyra can recover from player exits and network failures without crashing.
- v1 can be built without introducing infrastructure that only future platforms need.

---

This document should be updated when a major technical decision changes, especially around repository structure, IPC, cache format, or the ownership boundary between the Rust core and the desktop shell.