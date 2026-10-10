# Player support matrix

Which music players Lyra can follow on each OS, and which features work with
each. Update this file in the same change that adds, removes, or verifies an
adapter or player. The website names Spotify, Apple Music and YouTube Music
(`players.named` in `apps/website/src/site-config.js`) and otherwise says "most
players that show up in your computer's media controls"; name another player
there only once it has been verified.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Shipped and verified on that OS |
| 🧪 | Implemented; not yet verified with that player on that OS (see notes) |
| 🚧 | Planned; phase in brackets |
| ❓ | Depends on what the player reports; must be tested |
| ⚠️ | Works with a limitation (see notes) |
| ❌ | Not available through this path |

Feature columns:

- **Track**: title, artist, album and duration are detected.
- **Synced**: the player reports a position, so lyrics follow the song.
  Without it Lyra cannot sync lyrics yet; approximate sync is planned (🚧).
- **Play/pause**, **Skip** (next/previous), **Seek**: controls Lyra can send.
  Surfaces disable controls a player does not support.
- **Artwork**: cover art shown in surfaces.
- **File path**: the transport exposes the local audio file, needed for
  sidecar `.lrc` and embedded lyrics (🚧 P3). Collected today, not yet used.

Browser media (YouTube Music, Apple Music web, Spotify web, …) needs the
user's one-time consent before Lyra sends its title and artist to LRCLIB.

## Media detection (all OSes)

Lyra follows music only by default. Every session is classified as music,
not music, or unsure; ignored media is listed in Settings → Players and, when
nothing else is followed, named in the main window with a "Show lyrics
anyway" button.

| Signal | Where it comes from | Effect |
|---|---|---|
| Exact service (YouTube Music, Spotify, SoundCloud, Netflix, …) | Page URL (Linux browsers, KDE browser integration) or an installed web app's ID (e.g. the YouTube Music Chrome app on macOS) | Music services are music; film and streaming services are not |
| YouTube | "- Topic" and VEVO channels, "(Official Video)"-style titles, "Artist - Title" uploads | Shown as "YouTube in <browser>"; scored as below |
| Native app | Music players (Spotify, Music.app, foobar2000, …) are music; podcast apps and Spotify episodes are not; video players are scored | |
| Score | Album, music words (feat., remix, live at…), song-length duration, square artwork vs. non-music words (podcast, gameplay, review, tutorial…), very long or very short duration, question-style titles, missing artist | ≥ +3 music, ≤ −3 not music, otherwise unsure |
| Lyric verdict | Background LRCLIB lookup for unsure browser media (only when browser lookups are allowed) | Lyrics found → music; confirmed miss → not music |

Unsure media in native apps is followed. Unsure browser media is ignored
until the lookup decides, or stays ignored when lookups are off.

Overrides, highest first: a selected player (Settings → Players → Player:
"Only <app>" turns off automatic selection and follows that app whatever it
plays), per track ("Show lyrics anyway" / "Not music"), per app (Music only /
Always follow / Never follow), then the global "Only follow music" switch.
They are stored in `media_policy.json`.

Settings → Players lists active players (playing now, with per-track
overrides) and detected players: every app Lyra has seen, kept in
`known_players.json` (app name and ID, last seen; no track data), so per-app
rules and the selected player can be changed while the app is closed.
"Forget" removes an app and its rules until it plays again.

## Opening the player from Lyra

The main window shows the source's monochrome mark on the album art. Clicking it
brings the player forward on the current track where the OS allows:

| OS | Player | What opens |
|---|---|---|
| macOS | Spotify | The track in Spotify (`spotify:track:` link) |
| macOS | Music.app | Music, with the playing track selected |
| macOS | Now Playing apps and installed web apps | The app (YouTube Music app, browser window) |
| Windows | Packaged apps (Apple Music) | The app, through its app ID |
| Windows | Spotify | Spotify (`spotify:` link) |
| Windows | Browsers and other desktop apps | Not supported; the mark is not clickable |
| Linux | Players with MPRIS `CanRaise` | The player window (MPRIS `Raise`) |

Browser tabs cannot be selected without reading tabs, so a browser opens on
its front window.

Without page URLs (macOS and Windows browser tabs), Lyra cannot tell YouTube
Music from other music sites, so such media shows the browser name. Exact
site detection would need reading browser tabs, which was declined for now.

## macOS

| Player | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|
| Spotify | AppleScript | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | n/a |
| Apple Music (Music.app: streaming and local library) | AppleScript | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 local files |
| YouTube Music, Apple Music, Spotify web in Safari, Chrome, Arc, Edge, Firefox | MediaRemote | 🧪 | ❓ | ⚠️ | ⚠️ | ⚠️ | 🧪 | ❌ |
| IINA, VLC, Doppler and other Now Playing apps | MediaRemote | 🧪 | ❓ | ⚠️ | ⚠️ | ⚠️ | 🧪 | ❌ |
| Cider, th-ch YouTube Music (local APIs) | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | ❌ |

Notes:

- MediaRemote reports only the app macOS considers "now playing", and
  commands always go to that app (⚠️). When Spotify or Music.app is also
  visible through AppleScript, Lyra uses the AppleScript session.
- The MediaRemote adapter (`native/macos-sidecar/mediaremote-adapter`, run
  inside `/usr/bin/perl`) works **unsigned** on macOS 26.7.1 on Intel: verified
  2026-10-09 with Spotify as the Now Playing app (track, position, artwork,
  controls available). Not yet tested on Apple Silicon or with a browser as the
  source; browsers' position reporting (❓) needs that test.
- Music.app triggers its own Automation permission prompt the first time Lyra
  reads it.

## Windows

| Player | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|
| Spotify | SMTC | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | n/a |
| Apple Music for Windows | SMTC | 🧪 | ❓ | 🧪 | 🧪 | ❓ | 🧪 | ❌ |
| Firefox 125+ (YouTube Music and other web players) | SMTC | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | ❌ |
| Chrome, Edge, Chromium browsers (web players) | SMTC | 🧪 | ❓ | 🧪 | 🧪 | ❓ | 🧪 | ❌ |
| foobar2000, VLC, AIMP | SMTC | 🧪 | ❌ | 🧪 | 🧪 | ❌ | ⚠️ | ❌ |
| foobar2000 (beefweb), VLC (web interface), mpv (IPC) | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 |

Notes:

- Every SMTC session is observed; controls follow each session's SMTC control
  flags. Sessions without a timeline (EndTime 0) report no position, and seek
  is disabled for them.
- Community data suggests Chromium browsers may not publish an SMTC timeline;
  a run on Windows decides whether they sync (❓).
- Compile-checked with `cargo clippy --target x86_64-pc-windows-msvc`; not yet
  run on Windows.

## Linux

| Player | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|
| Spotify | MPRIS | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | n/a |
| Firefox, Chromium browsers (YouTube Music and other web players) | MPRIS | 🧪 | ❓ | 🧪 | 🧪 | ❓ | 🧪 | ❌ |
| VLC, Strawberry, Rhythmbox, Elisa and other MPRIS players | MPRIS | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 | 🧪 |
| MPD, mpv (IPC) | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 |

Notes:

- Every `org.mpris.MediaPlayer2.*` player is observed except `playerctld`;
  KDE's `plasma-browser-integration` duplicate of a browser session is dropped.
- Controls follow `CanControl`, `CanPlay`/`CanPause`, `CanGoNext`,
  `CanGoPrevious` and `CanSeek`; seeking falls back to relative `Seek` when a
  player has no usable track ID. `file://` artwork is served via `lyra-art://`.
- Apple Music has no Linux app; its web player is covered by the browser row.
- Type-checked with `cargo clippy --target x86_64-unknown-linux-gnu` (native
  library probes stubbed, nothing linked); not yet run on Linux.

## Verification log

| Date | OS | What was verified | How |
|---|---|---|---|
| 2026-10-09 | macOS | Player hub refactor builds; core and host tests pass | `cargo test`, `cargo clippy`, `pnpm lint`, `pnpm build` |
| 2026-10-09 | Windows | Core adapter type-checks; clippy clean | `cargo clippy -p lyra-core --target x86_64-pc-windows-msvc` |
| 2026-10-09 | macOS 26.7.1 (Intel) | MediaRemote adapter works unsigned; hub follows the Now Playing app (Spotify) with artwork and controls; helper process stops on shutdown | Live probe through `PlayerHub` |
| 2026-10-09 | macOS | Music.app, MediaRemote, metadata, hub and consent logic | 82 `lyra-core` unit tests |
| 2026-10-09 | Windows | All-sessions SMTC adapter type-checks; clippy clean | `cargo clippy -p lyra-core --target x86_64-pc-windows-msvc` |
| 2026-10-09 | Linux | All-players MPRIS adapter, its tests and the Tauri host type-check; clippy clean | `cargo clippy --target x86_64-unknown-linux-gnu` (core and host) with stubbed `pkg-config` |
| 2026-10-10 | macOS 26.7.1 (Intel) | YouTube Music Chrome app identified as YouTube Music, classified as music and followed through MediaRemote | Live probe through `PlayerHub` |
| 2026-10-10 | Any | LRCLIB verdicts separate a song ("Divinize", ROSALÍA: lyrics found) from a non-music video ("Why Do Cats Purr?", SciShow: confirmed miss) | Live `LyricsRefresh::probe` |
| 2026-10-10 | macOS 26.7.1 (Intel) | Running app follows Spotify (AppleScript) and the YouTube Music app (MediaRemote); Settings → Players lists both | `tauri dev`, user screenshots |
