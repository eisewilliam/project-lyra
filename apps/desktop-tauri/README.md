# Lyra Desktop Tauri App

This directory contains Lyra's Tauri 2 desktop host and React/Vite UI. It owns desktop windows, UI surfaces, settings controls, and the Tauri bridge to the shared Rust core.

## Surfaces

All windows are served from one SPA. [`src/main.tsx`](src/main.tsx) selects the view from the window path.

| Window label | Path | Role |
|---|---|---|
| `main` | `/` | Full Lyra window |
| `island` | `/island` | Floating island overlay |
| `karaoke` | `/karaoke` | Karaoke overlay |
| `settings` | `/settings` | Settings window |

## Commands

Run frontend and Tauri commands from this directory:

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
pnpm lint
```

The Vite-only commands remain available for frontend work:

```bash
pnpm dev
pnpm build
pnpm preview
```

Run Rust workspace checks from the repository root:

```bash
cargo test -p lyra-core
cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml
```

## Boundaries

UI surfaces render state from the backend and forward user intent through Tauri commands and events. Shared playback logic, lyric lookup, parsing, sync calculations, cache behavior, and core settings belong in `crates/lyra-core`.

The Tauri Rust layer in `src-tauri/` is the bridge around that core. It manages desktop concerns such as windows, tray actions, platform overlay behavior, UI state, and command/event wiring.

## Key Paths

| Path | Role |
|---|---|
| `src/views/app/` | Full Lyra window |
| `src/views/island/` | Floating island overlay |
| `src/views/karaoke/` | Karaoke overlay |
| `src/views/settings/` | Settings UI |
| `src-tauri/src/commands.rs` | Tauri commands exposed to the UI |
| `src-tauri/src/lib.rs` | App startup, runtime wiring, and playback polling |
| `src-tauri/src/ui_state.rs` | UI-facing persisted window and overlay state |
