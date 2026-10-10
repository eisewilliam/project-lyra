import type { PlayerApp } from '@/types/tauri-contracts';
import { BRAND_ICONS, type BrandIcon, type BrandIconKey } from './brand-icons';

/** Display names (lowercase) to brand icons. Services before apps. */
const BRAND_BY_NAME: ReadonlyArray<[string, BrandIconKey]> = [
  ['youtube music', 'youtubeMusic'],
  ['youtube', 'youtube'],
  ['spotify', 'spotify'],
  ['apple music', 'appleMusic'],
  ['itunes', 'appleMusic'],
  ['soundcloud', 'soundcloud'],
  ['deezer', 'deezer'],
  ['tidal', 'tidal'],
  ['bandcamp', 'bandcamp'],
  ['pandora', 'pandora'],
  ['audiomack', 'audiomack'],
  ['netflix', 'netflix'],
  ['twitch', 'twitch'],
  ['google chrome', 'chrome'],
  ['chromium', 'chrome'],
  ['safari', 'safari'],
  ['firefox', 'firefox'],
  ['mozilla firefox', 'firefox'],
  ['brave', 'brave'],
  ['opera', 'opera'],
  ['vivaldi', 'vivaldi'],
  ['arc', 'arc'],
  ['vlc', 'vlc'],
  ['vlc media player', 'vlc'],
  ['foobar2000', 'foobar2000'],
];

function brandFor(name: string | null | undefined): BrandIcon | null {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  const match = BRAND_BY_NAME.find(([known]) => lower === known);
  return match ? BRAND_ICONS[match[1]] : null;
}

/** Icon for where media plays: the service if recognised, else the app. */
export function sourceBrand(platform: string | null, player: PlayerApp | null): BrandIcon | null {
  return brandFor(platform) ?? brandFor(player?.name);
}
