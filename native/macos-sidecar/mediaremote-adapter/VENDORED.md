# Vendored: mediaremote-adapter

- Upstream: https://github.com/ungive/mediaremote-adapter
- Commit: 29718252613a5b0e210bdc64de0bd944ab379706 (2026-09-30)
- License: BSD 3-Clause (see `LICENSE`)

Lyra uses this adapter to read macOS Now Playing information (browsers and
other apps) through the MediaRemote framework, which macOS 15.4+ restricts to
entitled processes. The system Perl at `/usr/bin/perl` is entitled and loads
the adapter framework.

Local changes:

- Only the framework sources and the Perl script are kept. The CMake build,
  test client (`src/test`, `src/adapter/test.m`) and scripts are omitted, so
  the script's `test` function is unavailable.
- The framework is built by `apps/desktop-tauri/src-tauri/build.rs` with
  clang (universal arm64 + x86_64) instead of CMake.

To update: replace these files from a new upstream commit, update the commit
above, and rebuild. Keep the omitted files out.
