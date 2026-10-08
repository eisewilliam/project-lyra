export const siteConfig = {
  repository: 'https://github.com/EiseWilliam/project-lyra',
  releases: 'https://github.com/EiseWilliam/project-lyra/releases',
  // Populate with verified public release files when releases are published.
  downloads: { macos: null, windows: null, linux: null },
  // Early builds are not signed yet (README: "signing and distribution polish").
  signedBuilds: false,
};

export const platformNames = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

// Players Lyra follows today, and players already planned (docs/PRD.md).
// Lyra is not a Spotify-only product: add players here as their adapters ship
// and every page's copy follows.
export const players = { supported: ['Spotify'], planned: ['Apple Music'] };

const list = names => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
export const playersToday = list(players.supported);
export const playerApps = list(players.supported.map(name => name + ' desktop app'));
export const playersPlanned = players.planned.length ? list([...players.planned, 'more players']) : 'More players';

// Facts grounded in the repository README and platform adapters.
export const platformDetails = {
  macos: {
    needs: ['The ' + playerApps],
    playback: `Lyra reads what is playing through AppleScript. macOS asks once for permission to let Lyra see ${playersToday}.`,
    firstLaunch: 'Early builds are not signed. If macOS stops the first launch, Control-click Lyra in Applications and choose Open.',
  },
  windows: {
    needs: ['The ' + playerApps, 'WebView2, included with Windows 10 version 1803 and later'],
    playback: 'Lyra reads what is playing through the system media controls.',
    firstLaunch: 'Early builds are not signed. If SmartScreen appears, choose More info, then Run anyway.',
  },
  linux: {
    needs: ['The ' + playerApps, 'A desktop session with D-Bus'],
    playback: 'Lyra reads what is playing through the standard MPRIS service, so it works the same across distributions.',
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
