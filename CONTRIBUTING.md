# Contributing to Lyra

Thanks for your interest in improving Lyra. This document covers how to set up
the project, the conventions the codebase follows, and how to get a change
merged.

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you are expected to uphold it.

## Project layout

```text
apps/
  desktop-tauri/        Tauri 2 desktop host and React/Vite UI
    src/                Four SPA surfaces: main, island, karaoke, settings
    src-tauri/          Rust Tauri bridge, tray integration, window state
crates/
  lyra-core/            Shared Rust playback, lyrics, sync, cache, config logic
docs/                   Product and architecture notes
```

**Architectural rule:** all business logic lives in `lyra-core`. The Tauri
bridge only delegates to it, and the React surfaces render state — they never
compute it. Please keep that boundary intact. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

| Tool | Notes |
|---|---|
| Rust stable | Install with [rustup](https://rustup.rs) |
| Node.js 18+ | React/Vite frontend and Tauri CLI |
| npm | Bundled with Node.js |
| Platform build tools | Xcode Command Line Tools on macOS; Tauri prerequisites on Windows |
| Spotify desktop app | Lyra follows local Spotify playback state |

## Development

```bash
# Install frontend deps and run the app with hot reload
cd apps/desktop-tauri
npm install
npm run tauri dev
```

## Before you open a pull request

Run the same checks CI runs:

```bash
# Rust core tests (from repo root)
cargo test -p lyra-core

# Type-check the Tauri bridge without a full build
cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml

# Rust formatting and lints
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Frontend lint (from apps/desktop-tauri)
cd apps/desktop-tauri && npm run lint
```

## Pull request process

1. Fork the repo and create a topic branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Add or update tests when you change `lyra-core` behavior.
4. Make sure all checks above pass.
5. Write a clear PR description: what changed and why. Link any related issue.
6. Use [Conventional Commits](https://www.conventionalcommits.org/) style for
   commit messages where practical (e.g. `feat:`, `fix:`, `refactor:`, `docs:`).

## Reporting bugs and requesting features

Use the issue templates. For bugs, include OS + version, Spotify version, and
steps to reproduce. For security issues, do **not** open a public issue — see
[SECURITY.md](SECURITY.md).

## Scope notes

Lyra does not own or redistribute lyric content; it reads from
[LRCLIB](https://lrclib.net) at runtime. Please do not submit changes that
bundle lyric data with the application or that integrate sources requiring
proprietary API credentials without prior discussion in an issue.
