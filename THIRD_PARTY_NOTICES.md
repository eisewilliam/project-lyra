# Third-Party Notices

Lyra is built on open-source software. Each dependency remains under its own
license; this file summarizes the principal direct dependencies. It is not a
substitute for the full license texts, which ship with each crate/package and
are reproduced in the source distributions of those projects.

To regenerate a complete, machine-verified report of all Rust dependencies and
their licenses:

```bash
cargo install cargo-about
cargo about generate about.hbs > licenses.html   # requires an about.hbs template
# or, for a quick summary:
cargo install cargo-license && cargo license
```

For the frontend, license metadata can be summarized with:

```bash
cd apps/desktop-tauri && pnpm dlx license-checker --summary
```

## Principal direct dependencies

### Rust

| Crate | License |
|---|---|
| tauri, tauri-build, tauri-plugin-* | MIT OR Apache-2.0 |
| tauri-nspanel | MIT OR Apache-2.0 |
| tokio | MIT |
| reqwest | MIT OR Apache-2.0 |
| serde, serde_json | MIT OR Apache-2.0 |
| anyhow, thiserror | MIT OR Apache-2.0 |
| lru | MIT |
| urlencoding | MIT |
| base64 | MIT OR Apache-2.0 |
| log | MIT OR Apache-2.0 |
| dirs-next | MIT OR Apache-2.0 |
| objc2, objc2-foundation | MIT |
| objc2-app-kit | Zlib OR Apache-2.0 OR MIT |
| libc | MIT OR Apache-2.0 |
| dispatch2 | MIT OR Apache-2.0 |
| windows | MIT OR Apache-2.0 |

### JavaScript / TypeScript

| Package | License |
|---|---|
| react, react-dom | MIT |
| @tauri-apps/api, @tauri-apps/cli | MIT OR Apache-2.0 |
| vite, @vitejs/plugin-react | MIT |
| typescript | Apache-2.0 |
| eslint and plugins | MIT |

### Bundled native code

| Component | License | Notes |
|---|---|---|
| [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) | BSD 3-Clause, Copyright (c) 2025 Jonas van den Berg and contributors | macOS only; vendored in `native/macos-sidecar/mediaremote-adapter` and shipped as `MediaRemoteAdapter.framework` |

The BSD 3-Clause license requires its copyright notice, conditions and
disclaimer to accompany binary redistributions; the full text is in
`native/macos-sidecar/mediaremote-adapter/LICENSE` and is reproduced below.

```
BSD 3-Clause License

Copyright (c) 2025, Jonas van den Berg and contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Brand icons

Platform and app glyphs in `apps/desktop-tauri/src/utils/brand-icons.ts`
come from [Simple Icons](https://simpleicons.org), released under CC0 1.0,
and are used unmodified as monochrome marks.
The marks themselves are trademarks of their owners and are shown only to
indicate where audio is playing.

## Data services

- **Lyrics:** [LRCLIB](https://lrclib.net) — lyric content is fetched at runtime
  and is the property of its respective copyright holders. Lyra does not bundle
  or redistribute lyric content.

## Trademarks

"Spotify" is a trademark of Spotify AB. "Apple Music" is a trademark of Apple
Inc. "YouTube", "YouTube Music" and "Google Chrome" are trademarks of Google
LLC. Lyra is not affiliated with or endorsed by Spotify AB, Apple Inc. or
Google LLC. Other product names, logos and trademarks are the property of
their respective owners.
