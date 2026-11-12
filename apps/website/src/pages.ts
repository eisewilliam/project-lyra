import { siteConfig } from './site-config.ts';

// Every public page: its address, its title and description for search
// results, and its link-preview text where that differs. Each route's `head`
// comes from here, so the prerendered HTML carries these tags.

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** Link-preview title and description, when they differ from the page's own. */
  share?: { title: string; description: string };
}

export const pages = {
  home: {
    path: '/',
    title: 'Lyra Lyrics by Eiselabs, synced desktop lyrics for Mac, Windows and Linux',
    description: 'Free, open-source lyrics companion for Mac, Windows and Linux. Synced lyrics for whatever’s playing, powered by LRCLIB. Not a streaming app.',
    share: {
      title: 'Lyra — Keep the song in sight',
      description: 'Live lyrics for the song you’re playing, right on your desktop. Free and open source for macOS, Windows and Linux.',
    },
  },
  download: {
    path: '/download',
    title: 'Download Lyra',
    description: 'Free for macOS, Windows and Linux. Lyra works with Spotify, Apple Music, YouTube Music and most other players.',
  },
  macos: {
    path: '/macos',
    title: 'Lyra for macOS, synced lyrics for Spotify and Apple Music',
    description: 'Free, open-source synced lyrics on your Mac. Lyra follows Spotify, Apple Music and other apps in Now Playing. One universal build, signed and notarized.',
  },
  windows: {
    path: '/windows',
    title: 'Lyra for Windows, synced desktop lyrics',
    description: 'Free, open-source synced lyrics on Windows 10 and 11. Lyra follows Spotify, Apple Music, browsers and other players in the media controls.',
  },
  linux: {
    path: '/linux',
    title: 'Lyra for Linux, synced desktop lyrics (AppImage, deb, rpm)',
    description: 'Free, open-source synced lyrics on Linux, as an AppImage, deb or rpm. Lyra follows Spotify, browsers and any other player that supports MPRIS.',
  },
} satisfies Record<string, PageMeta>;

/** Title and description for unknown addresses. */
export const notFoundPage = {
  title: 'Page not found — Lyra',
  description: 'There’s nothing at this address.',
};

/** The link-preview image every page shares. */
export const shareImage = '/og-image.png';

/** A route's `head`: title, description, link-preview text and canonical link. */
export function pageHead(page: PageMeta) {
  const url = siteConfig.origin + page.path;
  const preview = page.share ?? page;
  return {
    meta: [
      { title: page.title },
      { name: 'description', content: page.description },
      { property: 'og:url', content: url },
      { property: 'og:title', content: preview.title },
      { property: 'og:description', content: preview.description },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}

/** schema.org description of the app, for the home page. */
export function structuredData(version: string = __LYRA_STABLE_VERSION__) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Lyra Lyrics',
    alternateName: 'Lyra Desktop',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS, Windows, Linux',
    ...(version ? { softwareVersion: version } : {}),
    license: 'https://opensource.org/licenses/MIT',
    url: siteConfig.origin + '/',
    downloadUrl: siteConfig.releases + '/latest',
    codeRepository: siteConfig.repository,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Organization', name: 'Eiselabs' },
  };
}
