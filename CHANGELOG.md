# Changelog

All notable changes to Lyra are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A version with a hyphen, such as `0.1.0-beta.1`, is a pre-release for testers:
it is downloaded from its release page, and installed copies of Lyra are never
offered it as an update.

## [Unreleased]

### Changed

- Changes to `main` require a pull request and passing checks for the parts of
  the project they affect. The project owner can merge without another review;
  other contributors need approval. Unchanged parts can skip their builds.

### Fixed

- Website changes can be previewed on their own branch before release.

## [0.2.1] - 2026-10-23

Lyrics load more reliably, and songs wrongly remembered as having no lyrics
find them.

### Fixed

- Lyrics load reliably when the lyric server is briefly overloaded. Lyra
  retries quietly instead of showing "Couldn't reach lyric server", and if a
  lookup still fails it keeps trying in the background, so lyrics appear on
  their own once the server recovers.
- When the lyric server is busy, Lyra now says so instead of suggesting your
  connection is down.
- Songs credited to several artists, such as "Ayra Starr, Danny Ocean", now
  find their lyrics.
- Songs that had no lyrics are checked again sooner: after a day at first,
  waiting longer only if they keep coming up empty. Songs remembered as having
  no lyrics are all checked again once after updating.
- The "no lyrics" message has a Search again button.

### Changed

- The website now offers public downloads for macOS, Windows and Linux, with
  direct download buttons in place of the coming-soon notice.
- The player support matrix confirms YouTube Music and YouTube in Chrome on
  macOS and Windows, including seeking and YouTube skipping within playlists.

## [0.2.0] - 2026-10-23

The first public release of Lyra for macOS, Windows and Linux. Includes the
desktop features introduced in the internal betas below.

### Added

- Signed and notarized macOS downloads for Apple silicon and Intel Macs.

### Fixed

- Release download links keep their version number after publication.

### Changed

- The player support matrix now records tested compatibility with Spotify,
  YouTube Music and YouTube on macOS and Windows, plus Apple Music on macOS.
- The website is available at lyra.eiselabs.com, with working direct page
  links and social previews, while the glass animation runs in your browser.
- The website's opening animation sets musical symbols in glass on a staff
  that runs across the whole page. The symbols work as lenses onto lines from
  public-domain songs drifting behind them, with a soft glow of their own.
  The glass has crisp edges and clear faces, notes spring out of the staff,
  rainbow edges appear briefly as a glimmer runs along the glass, and each
  figure melts back into the staff before the next one is written.
  On a first visit the staff's lines sweep in one after another, rippling
  like ribbons, then pull taut before the first symbol is written, while the
  headline rises in sharp. On a phone, tap the staff to pluck it.
- The website credits its maker by GitHub profile.
- The staff lines on the download page and at the end of the home page draw
  in as they come into view, then sway gently with a glint running along them.
- Links to the website show a preview image, title and description when
  shared on social networks and in chat apps, and links to the downloads page
  have their own.

## [0.2.0-beta.2] - 2026-10-20

An internal pre-release with the replacement updater signing key. Includes the
desktop changes listed under 0.2.0-beta.1; that build was not published.

### Fixed

- Update downloads use the corrected release signing key.

## [0.2.0-beta.1] - 2026-10-20

An internal pre-release for testing desktop changes ahead of 0.2.0.

### Added

- Release builds now check for signed updates.
- Internal macOS beta downloads are available before Apple signing is
  configured. They are marked unsigned and may need approval in Privacy &
  Security before opening.
- On a MacBook Pro with a Touch Bar, Lyra's Touch Bar shows previous,
  play/pause and next, then the line being sung with the next line after it,
  in your lyric font and color. Tap the lyrics to open Lyra. Choose which
  buttons it shows with View → Customize Touch Bar… or Settings → Touch Bar.
- Drag along the lyrics on the Touch Bar to move through the song. The lyrics
  stretch from the start of the song to the end and show the line wherever
  your finger is; lift your finger to jump there.
- To see lyrics on the Touch Bar while you use other apps, turn on Settings →
  Touch Bar → Show Lyra in the Control Strip, then tap the Lyra
  button. Tap × to put the other app's controls back. The Lyra button takes
  the place of the Control Strip's Now Playing button.
- The Marquee hides while nothing is playing and comes back when music
  starts. A paused song still shows. To keep it on screen, turn off
  Settings → Marquee → Hide when nothing is playing.

### Changed

- Settings has a new look: each group of settings sits on one quiet panel
  under a clear heading, the sidebar icons are softer, and sliders are slimmer
  with their value beside them. Marquee and Karaoke keep their live preview in
  view while you scroll their settings.
- Theme has moved from General to Appearance, and its Auto choice is now
  called System. Lyric blur is now four buttons: Off, Subtle, Standard and
  Strong.
- The main window's track menu (···) is now a standard system menu, so it
  looks and works like menus in other apps and is no longer cut off by the
  edge of a small window. On macOS 26 its items and the lyric line menu's
  have icons, as in Apple's own menus.
- The Marquee's size now looks about the same on every display: a new Size
  setting (Small to Extra large) scales the whole panel together, and Match
  screen, the default, picks the size for whichever display it is on. It never
  takes up more than 45% of a screen's width. Your current size carries over.
- The Marquee's Height setting is replaced by Lines: the current line only, or
  the current and next line. Width is now relative to the chosen size.
- The Marquee now starts at the bottom center of the screen, just above the
  Dock or taskbar, instead of at the top. When you let go of it, it stays
  clear of the menu bar, the notch, the Dock and the taskbar, and lines up
  with an edge or the middle of the screen when it's close to one. To keep it
  at the top of the screen, push it against the top edge and it docks there.
  If it is still in the top-center spot earlier versions started it in, it
  moves to the new place once.
- While Karaoke is on, the Marquee moves out of the way of its lyrics, and
  goes back when you turn Karaoke off.
- On macOS, the Dock, the menu bar and menus now appear in front of the
  Marquee instead of behind it. Docked at the top, the Marquee still covers
  the menu bar, but menus open in front of it.
- Placed under the notch on a MacBook, the Marquee keeps its lyrics below the
  notch instead of behind it.
- On a new install the Marquee's position isn't locked, so you can drag it
  straight away. Settings → Marquee → Lock position keeps it in place.

### Fixed

- With Hide when paused turned on, Lyra comes back when you press play again,
  even if all of its windows were hidden.
- On macOS, lyrics keep moving while a menu is open. Right-clicking a lyric
  line used to stop them until the menu closed.
- On Windows, Lyra could start with its window hidden and, once opened, stay
  on the loading screen without ever showing the playing song or its lyrics.
- With Keep window on top turned on, a maximized or full-screen Lyra window
  no longer hides every other window until it is minimized. It stays on top
  only at its normal size.

## [0.1.0-beta.1] - 2026-10-12

The first pre-release, for internal testing ahead of 0.1.0.

### Added

- Synced lyrics for whatever is playing, from LRCLIB, with word-by-word
  highlighting where the lyrics are timed per word. Songs with only untimed
  lyrics show them as plain text. Lyrics are cached, and Refresh lyrics fetches
  them again.
- Lyra follows the music player you are using rather than one service:
  - macOS: Spotify and Music, plus browsers and other Now Playing apps.
  - Windows: Spotify, Apple Music, browsers and other apps that report what's
    playing to Windows.
  - Linux: Spotify, browsers and other MPRIS players.
- Videos, podcasts and other media that isn't music are recognised and left
  alone. Settings → Players chooses which player to follow and whether to look
  up lyrics for media playing in a browser. Mark as not music stops Lyra
  following a track it mistook for music.
- Three places to read lyrics, each with its own settings:
  - The main window: cover art, playback controls, a progress bar that
    previews the lyric at any point, and lyrics you can click to jump to.
  - The Marquee: a dynamic panel docked at the top of the screen, on native
    glass on macOS, with a Transparency setting and cover art options.
  - The karaoke overlay: large lyrics at the top or bottom of the screen that
    clicks pass through, with position, width, alignment, line count and
    background settings.
- Sync lyrics: tap as a line is sung to line the lyrics up with the singer, or
  nudge them earlier or later. The timing is remembered for each song.
- A track menu in the main window with Sync lyrics, Refresh lyrics, Mark as not
  music and Settings.
- A menu-bar menu showing the playing track, with playback controls, Show
  Marquee, Show Karaoke Lyrics and Lock Marquee Position.
- Settings for theme, lyric font, size and colour, background darkness, lyric
  blur, battery saver, hiding Lyra while playback is paused, launching at
  login, and the display Lyra appears on.
- Keyboard: Space plays and pauses, ← and → seek, and on macOS ⌘← and ⌘→ skip
  tracks.
- A macOS app menu with About Lyra, Check for Updates…, Settings… (⌘,),
  Playback and Help.
- Automatic updates: release builds check in the background, download and
  verify signed updates, and install them when you choose Restart to Install.
- Installers for macOS (one universal build for Apple silicon and Intel, signed
  and notarized), Windows (setup `.exe` and `.msi`), and Linux (AppImage,
  `.deb` and `.rpm`).

### Known issues

- Windows installers are not code-signed yet, so Windows shows a SmartScreen
  warning on first launch.
- Most player and OS combinations are implemented but not yet verified; see
  [docs/PLAYER_SUPPORT.md](docs/PLAYER_SUPPORT.md).
- As a pre-release, this build is not offered as an update; install each beta
  from its release page.

[Unreleased]: https://github.com/eisewilliam/project-lyra/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/eisewilliam/project-lyra/releases/tag/v0.2.1
[0.2.0]: https://github.com/eisewilliam/project-lyra/releases/tag/v0.2.0
[0.2.0-beta.2]: https://github.com/eisewilliam/project-lyra/releases/tag/v0.2.0-beta.2
[0.2.0-beta.1]: https://github.com/eisewilliam/project-lyra/releases/tag/v0.2.0-beta.1
[0.1.0-beta.1]: https://github.com/eisewilliam/project-lyra/releases/tag/v0.1.0-beta.1
