# Lyra website

The Lyra marketing site, built on the accepted Direction 3 (Resonance): a landing page at `/` and a downloads page at `/download`. It is isolated from the Tauri app and shares no runtime code with it.

## Run and verify

From `apps/landing`:

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 4180 --strictPort
npm run build
npm run test:sites
node --test src/downloads.test.js
```

QA helpers: `?frame=<phrase>:<seconds>` renders one still frame of the hero light (phrases 0 to 3: bass clef, treble clef, beamed notes, fermata); `?motion=off` starts with the hero paused. In development the engine is exposed as `window.__lyricLight`.

## Structure

| Path | Purpose |
|---|---|
| `src/hero/lyric-light.js` | WebGL2 engine: lyric atlas, light mask, caustic shader, clock, quality fallback |
| `src/hero/phrases.js` | The four musical figures, authored in staff spaces, and their draw, hold and release timeline |
| `src/hero/lyrics.js` | Original lyric fragments for the hero field |
| `src/hero/LyricLightField.jsx` | React wrapper: sizing, visibility, pointer light, still-art fallback without WebGL2 |
| `src/demo/` | Original demo song, song clock, and illustrative recreations of the window, island and overlay |
| `src/landing/LandingPage.jsx` | Hero, surfaces stage, settings preview, steps, liner notes, FAQ, closing |
| `src/download/DownloadPage.jsx` | Platform rows, release status, build from source |
| `src/components/` | Router, header, footer, download button, staff-line motif |
| `src/site-config.js` | Repository, release and binary URLs; platform facts; platform detection |

## How the hero works

Two layers of drifting lyrics are drawn into a texture atlas. The shader multiplies them by a light mask, so they stay the colour of the page until light reaches them. Each frame a small 2D canvas draws the current phrase as light in three channels (body, glow, moving highlights) using outermost-first `source-over` passes, which keeps every draw on hardware blending. The shader adds a three-source caustic ripple, coloured falloff from teal to pale mint, a hand-held pointer light on fine pointers, and dims the light behind the hero copy.

The loop pauses when the hero is off screen or the tab is hidden, honours reduced motion with a lit still frame, has a pause control, lowers resolution on slow hardware, and falls back to the still Resonance artwork without WebGL2.

## Downloads and source

`src/site-config.js` centralises the repository (`https://github.com/EiseWilliam/project-lyra`, public later), the releases page and per-platform binary URLs. Binary URLs stay `null` until verified public files exist, so Download Lyra opens the downloads page with an honest pending state. Platform requirements and first-launch notes come from the repository README and platform adapters; update `signedBuilds` when releases are signed.

Lyra is not Spotify-only: other players are planned (Apple Music is named in `docs/PRD.md`). `players` in `src/site-config.js` lists supported and planned players, and the closing note, steps, liner notes, FAQ and downloads page read from it. Update the static meta description in `index.html` alongside it.

## References

- [Superdesign Spotlight Mask](https://superdesign.dev/library/spotlight-mask) and [Shader: Caustics](https://superdesign.dev/library?selected=shader-caustics&category=animation): reveal mechanism and the three-source interference ripple.
- [Superdesign Kilnwave](https://p.superdesign.dev/draft/90c604f5-749d-41fa-980c-a67def6594c4) and [One Page Love Extraordinary Things](https://onepagelove.com/extraordinary-things): atmosphere and sculptural light, from the approved exploration.
- [Saaspo](https://saaspo.com/): only the homepage loaded after a manual verification; deeper pages were re-challenged, so no Saaspo example is claimed as inspected.

Design notes, the token plan and review against the brief are in `docs/landing-explorations/2026-10-08-resonance-motion/`. Verification is recorded in [design-qa.md](design-qa.md).
