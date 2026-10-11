import type { IgnoreReason, PlayerApp } from '@/types/tauri-contracts';

/** Why Lyra is not following media, phrased for surfaces and settings. */
export const IGNORE_REASON_LABELS: Record<IgnoreReason, string> = {
  Podcast: 'Looks like a podcast or episode',
  VideoService: 'Plays on a film or streaming service',
  NotMusicSignals: 'Looks like a video, not music',
  NoLyricsFound: 'No lyrics found, so probably not music',
  Checking: 'Checking whether this is music…',
  Unconfirmed: "Can't tell whether this is music",
  AppRule: 'You chose never to follow this app',
  MarkedNotMusic: 'You marked this as not music',
  OtherPlayerSelected: 'Lyra is set to follow another player',
};

/** One- or two-word form of `IGNORE_REASON_LABELS` for status pills. */
export const IGNORE_REASON_SHORT: Record<IgnoreReason, string> = {
  Podcast: 'Podcast',
  VideoService: 'Video service',
  NotMusicSignals: 'Not music',
  NoLyricsFound: 'Not music',
  Checking: 'Checking',
  Unconfirmed: 'Unsure',
  AppRule: 'Blocked',
  MarkedNotMusic: 'Not music',
  OtherPlayerSelected: 'Not selected',
};

/** "YouTube in Google Chrome" when the service is known, else the app. */
export function mediaSourceLabel(player: PlayerApp | null, platform: string | null): string {
  const app = player?.name ?? 'Unknown player';
  return platform && platform !== app ? `${platform} in ${app}` : app;
}

/** The name people know the source by: the service if known, else the app. */
export function mediaSourceShortName(player: PlayerApp | null, platform: string | null): string {
  return platform ?? player?.name ?? 'Unknown player';
}
