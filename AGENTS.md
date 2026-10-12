# Lyra working guide

## Commands

All frontend commands run from `apps/desktop-tauri/`. All Rust commands run from the repo root unless noted.

```bash
# Dev (hot reload, opens Tauri windows)
cd apps/desktop-tauri && pnpm tauri dev

# Production build
cd apps/desktop-tauri && pnpm tauri build

# Rust core tests (including runtime and lyric refresh coordination)
cargo test -p lyra-core

# Single test
cargo test -p lyra-core <test_name>

# Type-check Rust without full compile
cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml

# Frontend lint
cd apps/desktop-tauri && pnpm lint
```

## Boundaries

- Business logic belongs in `crates/lyra-core`; Tauri delegates and UI renders.
- Preserve the four window surfaces and platform-specific behavior. Host code
  selects the application-support directory and passes it to core; core must not
  depend on Tauri or choose OS directories. Keep the `lyra` directory lowercase.
- Adapter calls and provider network awaits must not hold the runtime mutex.
- Preserve request deduplication, cancellation cleanup, confirmed-miss-only
  negative caching, manual retry, and override precedence.
- Use shared frontend status helpers and render snapshots. Do not introduce a
  frontend playback polling loop or assume every lyrics status is a plain string.
- Linux playback belongs in the MPRIS adapter; unavailable playback becomes a
  stopped snapshot. Detect Linux styling explicitly, not as a macOS fallback.
- Player access goes through `PlayerHub`: adapters report sessions, the
  registry picks the followed one, and commands route back through
  `PlayerHub::control`. Do not call adapters from Tauri commands directly.
- Keep `docs/PLAYER_SUPPORT.md` current in the same change whenever player,
  transport, or feature support changes or is verified on an OS.
- The `island` surface is called the **Marquee** in everything users see
  (described as a "dynamic panel"). Code identifiers, commands, events and
  saved `island_*` settings keep the `island` name until the code rename in
  issue #10, which migrates the saved keys with serde aliases. Never call it a
  "Dynamic Island".

## Read relevant reference sections before changing behavior

`docs/AGENT_ARCHITECTURE_REFERENCE.md` preserves the detailed implementation map:
- Tauri bridge, window behavior: Layer separation, The 4 Tauri windows, Rust state.
- Playback timing/events: Playback delivery and Frontend patterns.
- Fetch/cache/retry/persistence: Lyrics pipeline and Persistence stores.
- Platform adapters: Key lyra-core modules and Linux MPRIS integration.
- Player and feature support per OS: `docs/PLAYER_SUPPORT.md`.
- Releases, signing, updater and CI: `docs/RELEASING.md`.

Read only the relevant sections and their code, not the entire reference by default.
`docs/ARCHITECTURE.md` is the broader implementation map; product plans describe
intent and may include capabilities beyond the current implementation.
