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
cd apps/desktop-tauri && npx license-checker --summary
```

## Principal direct dependencies

### Rust

| Crate | License |
|---|---|
| tauri, tauri-build, tauri-plugin-* | MIT OR Apache-2.0 |
| tauri-nspanel (github.com/ahkohd/tauri-nspanel) | MIT |
| tokio | MIT |
| reqwest | MIT OR Apache-2.0 |
| serde, serde_json | MIT OR Apache-2.0 |
| anyhow, thiserror | MIT OR Apache-2.0 |
| lru | MIT |
| urlencoding | MIT |
| base64 | MIT OR Apache-2.0 |
| log | MIT OR Apache-2.0 |
| dirs-next | MIT OR Apache-2.0 |
| objc | MIT |
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

## Data services

- **Lyrics:** [LRCLIB](https://lrclib.net) — lyric content is fetched at runtime
  and is the property of its respective copyright holders. Lyra does not bundle
  or redistribute lyric content.

## Trademarks

"Spotify" is a trademark of Spotify AB. Lyra is not affiliated with or endorsed
by Spotify AB. Other product names and trademarks are the property of their
respective owners.
