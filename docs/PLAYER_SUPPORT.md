# Player support matrix

Which music players Lyra can follow on each OS, and which features work with
each. Update this file in the same change that adds, removes, or verifies an
adapter or player. The website names Spotify, Apple Music and YouTube Music
(`players.named` in `apps/website/src/site-config.ts`) and otherwise says "most
players that show up in your computer's media controls"; name another player
there only once it has been verified.

The main window can time plain or pasted lyrics whenever a followed player reports a live playback position. Seeking is optional. Local saves work without album metadata. Sharing to LRCLIB requires a title, artist, album and track length.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Player confirmed working on that OS |
| 🧪 | Player implemented; live verification not yet recorded on that OS |
| ✓ | Feature supported through this transport |
| 🚧 | Planned; phase in brackets |
| ❓ | Depends on the capabilities or data the player reports |
| ⚠️ | Works with a limitation (see notes) |
| ❌ | Not available through this path |

Feature columns:

- **Status** records player verification. Feature columns describe available
  capabilities; they are not separate test results for every control.
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

User testing reported on 2026-10-23 confirms Spotify, YouTube Music, YouTube
and Apple Music on macOS, and Spotify, YouTube Music and YouTube on Windows.
These players are marked ✅ in the tables below. YouTube Music and YouTube
were tested in Chrome on both OSes, including seeking. YouTube skipping works
within playlists. OS and app versions were not specified; browser results
apply to Chrome with these players.

## Lyrics and global shortcuts

The main window can find text in synced or plain lyrics. Jumping from a
search result requires timed lyrics and a player that supports seeking. The
vocal countdown requires timed lyrics and a reported playback position.

Settings → General can enable global shortcuts for Marquee, Karaoke,
click-through, and lyric timing on macOS, Windows, and Linux with X11.
Timing shortcuts apply while a lyric window is visible.
Native Wayland sessions cannot register these shortcuts. Under XWayland,
availability depends on the desktop compositor.

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

Settings → Players lists what is playing now (with per-track overrides)
and remembered players: every app Lyra has seen, kept in
`known_players.json` (app name and ID, last seen; no track data), so per-app
rules and the selected player can be changed while the app is closed.
"Forget" removes an app and its rules until it plays again.

## Opening the player from Lyra

The main window shows the source's monochrome mark on the album art. Clicking it
brings the player forward as it was, without changing what it shows, where the
OS allows:

| OS | Player | What opens |
|---|---|---|
| macOS | Spotify, Music.app, Now Playing apps and installed web apps | The app, by bundle ID (YouTube Music app, browser window) |
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

| Player | Status | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|---|
| Spotify | ✅ | AppleScript | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| Apple Music (Music.app: streaming and local library) | ✅ | AppleScript | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ local files |
| YouTube Music in Chrome | ✅ | MediaRemote | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ❌ |
| YouTube in Chrome | ✅ | MediaRemote | ✓ | ✓ | ✓ | ⚠️ playlists | ✓ | ✓ | ❌ |
| Other web players (Apple Music, Spotify web) in Safari, Chrome, Arc, Edge, Firefox | 🧪 | MediaRemote | ✓ | ❓ | ⚠️ | ⚠️ | ⚠️ | ✓ | ❌ |
| IINA, VLC, Doppler and other Now Playing apps | 🧪 | MediaRemote | ✓ | ❓ | ⚠️ | ⚠️ | ⚠️ | ✓ | ❌ |
| Cider, th-ch YouTube Music (local APIs) | 🚧 P4 | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | ❌ |

Notes:

- MediaRemote reports only the app macOS considers "now playing", and
  commands always go to that app (⚠️). When Spotify or Music.app is also
  visible through AppleScript, Lyra uses the AppleScript session.
- Seeking works in YouTube Music and YouTube in Chrome. YouTube skipping
  works within playlists (⚠️).
- The MediaRemote adapter (`native/macos-sidecar/mediaremote-adapter`, run
  inside `/usr/bin/perl`) works **unsigned** on macOS 26.7.1 on Intel: verified
  2026-10-09 with Spotify as the Now Playing app (track, position, artwork,
  controls available). Apple Silicon verification has not been recorded.
  YouTube Music and YouTube were later confirmed working in user testing.
  Other browser/player combinations depend on position reporting (❓).
- Music.app triggers its own Automation permission prompt the first time Lyra
  reads it.
- Music.app gives AppleScript no artwork for streamed tracks that are not in
  the library (`URL track`, zero artworks). Lyra then uses the artwork of the
  Now Playing session for Music.app when it shows the same title, so the
  cover appears while Music.app is the app macOS considers "now playing".
- On a MacBook Pro with a Touch Bar, dragging along Lyra's lyrics seeks when
  the followed player supports seeking and reports a track duration. The drag
  previews the lyric at that position and sends the seek when released. This
  path has unit coverage; native Touch Bar interaction for 0.2.0-beta.1 remains
  unverified.

## Windows

| Player | Status | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|---|
| Spotify | ✅ | SMTC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| YouTube Music in Chrome | ✅ | SMTC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ❌ |
| YouTube in Chrome | ✅ | SMTC | ✓ | ✓ | ✓ | ⚠️ playlists | ✓ | ✓ | ❌ |
| Apple Music for Windows | 🧪 | SMTC | ✓ | ❓ | ✓ | ✓ | ❓ | ✓ | ❌ |
| Other web players in Firefox 125+ | 🧪 | SMTC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ❌ |
| Other web players in Chrome, Edge, Chromium browsers | 🧪 | SMTC | ✓ | ❓ | ✓ | ✓ | ❓ | ✓ | ❌ |
| foobar2000, VLC, AIMP | 🧪 | SMTC | ✓ | ❌ | ✓ | ✓ | ❌ | ⚠️ | ❌ |
| foobar2000 (beefweb), VLC (web interface), mpv (IPC) | 🚧 P4 | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 |

Notes:

- Every SMTC session is observed; controls follow each session's SMTC control
  flags. Sessions without a timeline (EndTime 0) report no position, and seek
  is disabled for them.
- Chrome testing confirmed seeking in YouTube Music and YouTube. Other
  browser/player combinations still depend on the timeline they publish (❓).
- YouTube skipping works within playlists (⚠️).
- Spotify, YouTube Music and YouTube were confirmed working on Windows in
  user testing reported on 2026-10-23; browser playback was tested in Chrome.
- Adapter previously compile-checked with
  `cargo clippy --target x86_64-pc-windows-msvc`.

## Linux

| Player | Status | Transport | Track | Synced | Play/pause | Skip | Seek | Artwork | File path |
|---|---|---|---|---|---|---|---|---|---|
| Spotify | 🧪 | MPRIS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| Firefox, Chromium browsers (YouTube Music and other web players) | 🧪 | MPRIS | ✓ | ❓ | ✓ | ✓ | ❓ | ✓ | ❌ |
| VLC, Strawberry, Rhythmbox, Elisa and other MPRIS players | 🧪 | MPRIS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MPD, mpv (IPC) | 🚧 P4 | Local API | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 | 🚧 P4 |

Notes:

- Every `org.mpris.MediaPlayer2.*` player is observed except `playerctld`;
  KDE's `plasma-browser-integration` duplicate of a browser session is dropped.
- Controls follow `CanControl`, `CanPlay`/`CanPause`, `CanGoNext`,
  `CanGoPrevious` and `CanSeek`; seeking falls back to relative `Seek` when a
  player has no usable track ID. `file://` artwork is served via `lyra-art://`.
- Apple Music has no Linux app; its web player is covered by the browser row.
- On Fedora 45 Workstation (x86-64, GNOME in UTM), Lyra 0.3.0-beta.2 followed
  Rhythmbox over MPRIS, showed the track title and artist, and controlled
  pause, resume, and seek. The published RPM needed Fedora's `openssl3-libs`
  package before it could launch on the clean guest.
- On the same guest, the local build's Marquee measured 48 px with one line
  and 61 px with two lines at the tested display size, using XWayland.

## Discord presence

Off by default (Settings → General → Discord). Publishes the followed track
to the Discord desktop app on the same computer; nothing is sent while
paused, stopped, or for media Lyra does not follow.

| | macOS | Windows | Linux |
|---|---|---|---|
| Connection | Unix socket in `$TMPDIR` | Named pipe `discord-ipc-N` | Unix socket in `$XDG_RUNTIME_DIR`, including Flatpak and Snap Discord and Vesktop |
| Status | ✅ Activity seen on a Discord profile (Apple Music) | 🧪 Type-checked only | 🧪 Not yet built or run |

- Title, artist, album and progress bar come from any followed player. The
  progress bar needs a reported position and normal playback speed.
- Cover art comes from the player when it gives a public `https` URL
  (Spotify). For players that expose artwork as bytes (Music.app, Now Playing
  apps, SMTC, local MPRIS files) Lyra looks the cover up in Apple's music
  catalogue (the iTunes Search API) by artist and title, and uses it only
  when a result's title and lead artist match. Until a cover is found, and
  for songs the catalogue lacks, Discord shows the Lyra application icon.
- The lookup uses the catalogue's default (United States) storefront, so a
  song sold only elsewhere gets no cover. Browser media is looked up only
  when browser lyric lookups are allowed. 🧪 Not yet seen on a Discord
  profile: whether Discord loads the catalogue's image URLs is unconfirmed.
- Spotify, in its app or a browser, is skipped unless "Include Spotify" is
  on: Discord shows Spotify itself for linked accounts.
- Needs `DISCORD_APPLICATION_ID` in the host; without it the setting is
  hidden.

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
| 2026-10-19 | macOS | Desktop release source checks: 118 core and 45 host unit tests, formatting, Clippy, frontend lint/build; native interaction and signed installers remain unverified | `cargo test --workspace`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm lint`, `pnpm build` |
| 2026-10-23 | macOS | Spotify, YouTube Music, YouTube and Apple Music confirmed working; browser playback tested in Chrome, including seeking; YouTube skipping works within playlists | User-reported manual testing |
| 2026-10-23 | Windows | Spotify, YouTube Music and YouTube confirmed working; browser playback tested in Chrome, including seeking; YouTube skipping works within playlists | User-reported manual testing |
| 2026-11-10 | Linux, Windows | Tauri host type-checks with single-instance handling, the XWayland preference and deferred click-through; no warnings from that code. Not run on either OS | `cargo clippy --all-targets` for `x86_64-unknown-linux-gnu` and `x86_64-pc-windows-msvc` with stubbed `pkg-config`, C compiler and resource compiler |
| 2026-11-13 | macOS | Discord presence: activity mapping, framing, reconnect, rate-limit and settings logic | 16 `lyra-core` unit tests against a stand-in Discord on a socket pair |
| 2026-11-13 | macOS | Discord presence transport reaches the running Discord app: socket found, handshake framed and answered (refused with "4000 Invalid Client ID" for a made-up ID). No activity published yet: no application ID | Live `Connection::open` probe |
| 2026-11-13 | Windows | Discord presence named-pipe transport type-checks | `cargo check -p lyra-core --target x86_64-pc-windows-msvc` |
| 2026-11-15 | macOS | Discord presence shows on a Discord profile with Apple Music (Music.app) playing: "Listening to Lyra", title, artist, album and progress bar with elapsed and total time. With no cover URL from the player, Discord shows the Lyra application icon | Screenshot of the profile's activity card, 0.3.0-beta.1 |
| 2026-11-15 | macOS | Discord cover lookup: result matching, album reuse, one cover per album for a repeated title, misses and failures kept apart, consent for browser media, one extra update when a cover arrives | 13 `lyra-core` unit tests against a stand-in catalogue and Discord |
| 2026-11-15 | macOS | Discord cover lookup reaches Apple's catalogue and returns a 512-pixel `https` cover. Not yet seen on a Discord profile | Live lookups through `CoverArt`: two known songs found in 1.4 s and (after the 3 s spacing) 3.3 s, a made-up song a miss; the returned image URL loads |
| 2026-11-16 | macOS 26 | Apple Music streamed track outside the library (`URL track`): AppleScript reports no artwork, the Now Playing session reports a JPEG for the same title; the followed AppleScript session now carries that artwork | `osascript` query of Music.app, then live polls of `PlayerHub` with the Music.app and MediaRemote adapters, before and after the fix |
