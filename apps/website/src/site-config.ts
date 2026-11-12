export const platforms = ['macos', 'windows', 'linux'] as const;
export type Platform = (typeof platforms)[number];

export const isPlatform = (value: unknown): value is Platform => platforms.some(platform => platform === value);

// The site credits its maker by GitHub handle rather than full name.
const maker = 'eisewilliam';
const repository = `https://github.com/${maker}/project-lyra`;

// The stable release and installers are publicly available without signing in.
const releasesPublished = true;

// Fixed file names from the release workflow (.github/workflows/release.yml),
// always pointing at the newest published release.
const latest = (file: string) => `${repository}/releases/latest/download/${file}`;

export interface Installer {
  /** File type, as the download button names it. */
  label: string;
  /** Who it is for. */
  detail: string;
  file: string;
}

// Every installer a stable release publishes, by platform
// (docs/RELEASING.md). The first is the one the download buttons offer.
export const installers: Record<Platform, readonly [Installer, ...Installer[]]> = {
  macos: [{ label: '.dmg', detail: 'Apple silicon and Intel Macs', file: 'Lyra-macos-universal.dmg' }],
  windows: [
    { label: '.exe', detail: 'Setup program, 64-bit', file: 'Lyra-windows-x64-setup.exe' },
    { label: '.msi', detail: 'Windows Installer package', file: 'Lyra-windows-x64.msi' },
  ],
  linux: [
    { label: 'AppImage', detail: 'Runs on most distributions', file: 'Lyra-linux-amd64.AppImage' },
    { label: '.deb', detail: 'Debian and Ubuntu', file: 'Lyra-linux-amd64.deb' },
    { label: '.rpm', detail: 'Fedora and openSUSE', file: 'Lyra-linux-x86_64.rpm' },
  ],
};

interface SiteConfig {
  /** The production address, for the sitemap and structured data. */
  origin: string;
  maker: { handle: string; profile: string };
  repository: string;
  releases: string;
  /** Download address for an installer, or null before releases are public. */
  download: (file: string) => string | null;
  downloads: Record<Platform, string | null>;
  /** Signed builds open without a security warning on first launch. */
  signed: Record<Platform, boolean>;
}

export const siteConfig: SiteConfig = {
  origin: 'https://lyra.eiselabs.com',
  maker: { handle: maker, profile: `https://github.com/${maker}` },
  repository,
  releases: repository + '/releases',
  download: file => (releasesPublished ? latest(file) : null),
  downloads: releasesPublished
    ? { macos: latest(installers.macos[0].file), windows: latest(installers.windows[0].file), linux: latest(installers.linux[0].file) }
    : { macos: null, windows: null, linux: null },
  // macOS builds are signed and notarized; Windows builds are not signed yet.
  signed: { macos: true, windows: false, linux: false },
};

export const platformNames: Record<Platform, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

// Players named on the site (see docs/PLAYER_SUPPORT.md). Lyra also follows
// most players that show up in the computer's media controls, so name a
// player here once it has been tested; every page's copy follows.
export const players: { named: readonly string[] } = { named: ['Spotify', 'Apple Music', 'YouTube Music'] };

// Named players plus a closing phrase as one list, so copy never doubles its
// "and" or "or": "Spotify, Apple Music, YouTube Music and most players…"
// (British list style, like the rest of the site).
const listWith = (rest: string, type: Intl.ListFormatType) =>
  new Intl.ListFormat('en-GB', { style: 'long', type }).format([...players.named, rest]);
export const playersAndOthers = listWith('most players that show up in your computer’s media controls', 'conjunction');
export const playersOrOthers = listWith('another player that shows up in your computer’s media controls', 'disjunction');

interface PlatformDetails {
  needs: string[];
  playback: string;
  firstLaunch: string | null;
}

// Facts grounded in the repository README and platform adapters.
export const platformDetails: Record<Platform, PlatformDetails> = {
  macos: {
    needs: [listWith('another player that shows up in Now Playing', 'disjunction')],
    playback: 'Lyra reads Spotify and Apple Music through AppleScript, and other apps and browsers through Now Playing. macOS asks once for permission before Lyra can see Spotify or Music.',
    firstLaunch: null,
  },
  windows: {
    needs: [listWith('another player that shows up in the media controls', 'disjunction'), 'WebView2, included with Windows 10 version 1803 and later'],
    playback: 'Lyra reads what is playing through the system media controls, so it follows Spotify, Apple Music, browsers and most other players.',
    firstLaunch: 'Windows installers are not code-signed yet. If SmartScreen appears, choose More info, then Run anyway.',
  },
  linux: {
    needs: ['Spotify, a browser, or another player that supports MPRIS', 'A desktop session with D-Bus'],
    playback: 'Lyra reads what is playing through the standard MPRIS service, so it works the same across distributions. Apple Music and YouTube Music play in a browser there.',
    firstLaunch: null,
  },
};

interface DeviceIdentity {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export function detectPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 }: DeviceIdentity = {}): Platform | null {
  const identity = (platform + ' ' + userAgent).toLowerCase();
  if (/android|iphone|ipad|ipod|mobile|cros/.test(identity)) return null;
  if (/mac/.test(identity) && maxTouchPoints > 1) return null;
  if (/windows|win32|win64/.test(identity)) return 'windows';
  if (/mac/.test(identity)) return 'macos';
  if (/linux|x11/.test(identity)) return 'linux';
  return null;
}

// User-Agent Client Hints are Chromium-only, so they are not in the DOM types.
type ClientHintsNavigator = Navigator & { userAgentData?: { platform: string } };

export function visitorPlatform(): Platform | null {
  const { userAgentData } = navigator as ClientHintsNavigator;
  return detectPlatform({
    userAgent: navigator.userAgent,
    platform: userAgentData?.platform || navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
