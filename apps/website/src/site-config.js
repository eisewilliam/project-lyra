export const siteConfig = {
  repository: 'https://github.com/EiseWilliam/project-lyra',
  releases: 'https://github.com/EiseWilliam/project-lyra/releases',
  // Populate with verified public release files when releases are published.
  downloads: { macos: null, windows: null, linux: null },
  // Early builds are not signed yet (README: "signing and distribution polish").
  signedBuilds: false,
};

export const platformNames = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

// Players named on the site (see docs/PLAYER_SUPPORT.md). Lyra also follows
// most players that show up in the computer's media controls, so name a
// player here once it has been tested; every page's copy follows.
export const players = { named: ['Spotify', 'Apple Music', 'YouTube Music'] };

// Named players plus a closing phrase as one list, so copy never doubles its
// "and" or "or": "Spotify, Apple Music, YouTube Music and most players…"
// (British list style, like the rest of the site).
const listWith = (rest, type) =>
  new Intl.ListFormat('en-GB', { style: 'long', type }).format([...players.named, rest]);
export const playersAndOthers = listWith('most players that show up in your computer’s media controls', 'conjunction');
export const playersOrOthers = listWith('another player that shows up in your computer’s media controls', 'disjunction');

// Facts grounded in the repository README and platform adapters.
export const platformDetails = {
  macos: {
    needs: [listWith('another player that shows up in Now Playing', 'disjunction')],
    playback: 'Lyra reads Spotify and Apple Music through AppleScript, and other apps and browsers through Now Playing. macOS asks once for permission before Lyra can see Spotify or Music.',
    firstLaunch: 'Early builds are not signed. If macOS stops the first launch, Control-click Lyra in Applications and choose Open.',
  },
  windows: {
    needs: [listWith('another player that shows up in the media controls', 'disjunction'), 'WebView2, included with Windows 10 version 1803 and later'],
    playback: 'Lyra reads what is playing through the system media controls, so it follows Spotify, Apple Music, browsers and most other players.',
    firstLaunch: 'Early builds are not signed. If SmartScreen appears, choose More info, then Run anyway.',
  },
  linux: {
    needs: ['Spotify, a browser, or another player that supports MPRIS', 'A desktop session with D-Bus'],
    playback: 'Lyra reads what is playing through the standard MPRIS service, so it works the same across distributions. Apple Music and YouTube Music play in a browser there.',
    firstLaunch: null,
  },
};

export function detectPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const identity = (platform + ' ' + userAgent).toLowerCase();
  if (/android|iphone|ipad|ipod|mobile|cros/.test(identity)) return null;
  if (/mac/.test(identity) && maxTouchPoints > 1) return null;
  if (/windows|win32|win64/.test(identity)) return 'windows';
  if (/mac/.test(identity)) return 'macos';
  if (/linux|x11/.test(identity)) return 'linux';
  return null;
}

export function visitorPlatform() {
  return detectPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
