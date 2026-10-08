# Landing site instructions

## Accepted design decisions

- Direction 3, Resonance, is the accepted direction (user naming: direction 1 is Living Score, direction 3 is Resonance). The site is one landing page at `/` plus a downloads page at `/download`. Living Score is retired; its prototype source is archived in `design/archive/2026-10-08-two-direction-prototype/`.
- The hero background is accepted: a procedural WebGL lyric field (`src/hero/`). Original lyrics drift in the background colour and are only visible where a staff-shaped light falls; the light draws a musical figure (bass clef, treble clef, beamed notes, fermata), holds, dims to darkness and starts again. It is never a static image except as the no-WebGL fallback.
- Buttons carry at most one icon. The primary Download Lyra button shows only the detected platform's icon (a download glyph when unknown). Button heights by role: 54px hero/closing, 46px secondary, 38px header.
- Platform icons are solid brand marks in `src/components/OsIcons.jsx` (Apple and Tux from Simple Icons, Windows as four panes), not Phosphor's outline OS icons. The player-support note lives by the closing CTA and on `/download`, never in the hero.
- Other downloads is its own page (`/download`), not a dialog. The detected platform is listed first and lit; `?platform=` preselects one.
- Lyra is not a Spotify-only product: support for other music players is already planned (Apple Music is named in `docs/PRD.md`). Write copy that is player-agnostic and say which players work today. Supported and planned players live in `players` in `src/site-config.js`; copy reads from it, so adding a player is a data change (also update the static meta description in `index.html`).
- Visible primary CTA is Download Lyra; communicate the detected desktop OS only through its icon. Keep a small Star on GitHub header action.
- Sections beyond the hero must present the product, not just describe it: the stage recreates Lyra's three surfaces playing an original demo song in sync; settings are tried live; steps sit on a staff as measures; privacy and credits are liner notes.
- Type: Geist only. Upright for interface and headings; italic wherever words are sung (hero field, staff lyrics, liner-note roles). No tracked all-caps eyebrows, no numbering unless the content is a sequence.
- Use only the logo and colours from local branding. Do not use brandboard layouts, typography prescriptions, local mockups, albums or desktop scenes from the brand explorations.
- GitHub will become public later. Public download files are not yet supplied; keep honest pending-release states and centralise destinations and platform facts in `src/site-config.js`. Every lyric shown on the site is original.

Run the local server yourself and open the preview in the browser available to this environment. Port 4173 may be taken by another local project; use any free port with `--strictPort`. Do not give the user server-start instructions when you can run it.

When the user gives durable design feedback, preferences or decisions, record them here.

Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs` intact so the site can be handed to Sites. The worker's HTML fallback serves `/download`. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`.
