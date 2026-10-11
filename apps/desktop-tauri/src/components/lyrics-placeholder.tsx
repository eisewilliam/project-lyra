import type { BrowserLyrics, IgnoredMedia } from '@/types/tauri-contracts';
import { IGNORE_REASON_LABELS, mediaSourceLabel } from '@/utils/media-labels';
import {
  type LyricsPlaceholderState,
  type NotFoundReason,
} from '@/utils/lyrics-state';
import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';
import { BRAND_ICONS } from '@/utils/brand-icons';
import { SourceIcon } from './source-icon';

/** Players shown in the empty state; most others work through media controls. */
const EMPTY_STATE_PLAYERS = [
  { key: 'spotify', name: 'Spotify', brand: BRAND_ICONS.spotify },
  { key: 'apple-music', name: 'Apple Music', brand: BRAND_ICONS.appleMusic },
  { key: 'youtube-music', name: 'YouTube Music', brand: BRAND_ICONS.youtubeMusic },
] as const;

export function LyricsPlaceholder({
  state,
  notFoundReason,
  onRetry,
  onBrowserLyrics,
  ignored,
  onFollowIgnored,
  onFollowAutomatically,
  automationDenied,
  onOpenAutomationSettings,
}: Readonly<{
  state: LyricsPlaceholderState;
  notFoundReason?: NotFoundReason | null;
  onRetry?: () => void;
  /** Answers the one-time browser-media lookup prompt (`consent` state). */
  onBrowserLyrics?: (choice: BrowserLyrics) => void;
  /** Media playing but not followed; shown in the `idle` state. */
  ignored?: IgnoredMedia | null;
  /** Follow the ignored media anyway (marks it as music). */
  onFollowIgnored?: () => void;
  /** Return to automatic player selection when another player is pinned. */
  onFollowAutomatically?: () => void;
  /** Players macOS refused to let Lyra read (Automation permission). */
  automationDenied?: ReadonlyArray<string>;
  onOpenAutomationSettings?: () => void;
}>) {
  const loading = state === 'booting' || state === 'loading';
  const ignoredNow = state === 'idle' ? ignored ?? null : null;
  const deniedNow = state === 'idle' && !ignoredNow && automationDenied && automationDenied.length > 0
    ? automationDenied
    : null;
  const emptyNow = state === 'idle' && !ignoredNow && !deniedNow;
  let label = getPlaceholderLabel(state, notFoundReason ?? null);
  if (ignoredNow) label = `Not following “${ignoredNow.title}”`;
  else if (deniedNow) label = `Lyra can't see ${deniedNow.join(' or ')}`;

  return (
    <div className={`lyrics-placeholder is-${state} ${loading ? 'is-loading' : ''}`}>
      <output className="lyrics-placeholder-card" aria-label={label}>
        <div className="lyrics-placeholder-orb" aria-hidden="true">
          <span className="lyrics-placeholder-ring" />
          <span className="lyrics-placeholder-core">
            <LyricsPlaceholderIcon state={state} className="lyrics-placeholder-icon" />
          </span>
        </div>

        {loading ? (
          <div className="lyrics-placeholder-dots" aria-hidden="true">
            <span className="lyrics-placeholder-dot" />
            <span className="lyrics-placeholder-dot" />
            <span className="lyrics-placeholder-dot" />
          </div>
        ) : (
          <p className="lyrics-placeholder-label">{label}</p>
        )}

        {deniedNow ? (
          <>
            <p className="lyrics-placeholder-note">
              Allow Lyra under Privacy &amp; Security → Automation in System Settings.
            </p>
            {onOpenAutomationSettings ? (
              <div className="lyrics-placeholder-actions">
                <button type="button" className="lyrics-placeholder-retry" onClick={onOpenAutomationSettings}>
                  Open Privacy Settings
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {emptyNow ? (
          <>
            <p className="lyrics-placeholder-note">
              Lyra follows Spotify, Apple Music and most players in your media controls.
            </p>
            <div className="lyrics-placeholder-players" aria-hidden="true">
              {EMPTY_STATE_PLAYERS.map((player) => (
                <span key={player.key} className="lyrics-placeholder-player" title={player.name}>
                  <SourceIcon brand={player.brand} size={16} />
                </span>
              ))}
            </div>
          </>
        ) : null}

        {ignoredNow ? (
          <p className="lyrics-placeholder-note">
            {mediaSourceLabel(ignoredNow.player, ignoredNow.platform)} · {IGNORE_REASON_LABELS[ignoredNow.reason]}
          </p>
        ) : null}

        {ignoredNow?.reason === 'OtherPlayerSelected' && onFollowAutomatically ? (
          <div className="lyrics-placeholder-actions">
            <button type="button" className="lyrics-placeholder-retry" onClick={onFollowAutomatically}>
              Follow any player
            </button>
          </div>
        ) : null}

        {ignoredNow && ignoredNow.reason !== 'OtherPlayerSelected' && onFollowIgnored ? (
          <div className="lyrics-placeholder-actions">
            <button type="button" className="lyrics-placeholder-retry" onClick={onFollowIgnored}>
              Show lyrics anyway
            </button>
          </div>
        ) : null}

        {state === 'consent' ? (
          <p className="lyrics-placeholder-note">
            Lyra sends the title and artist to LRCLIB to find lyrics.
          </p>
        ) : null}

        {state === 'consent' && onBrowserLyrics ? (
          <div className="lyrics-placeholder-actions">
            <button type="button" className="lyrics-placeholder-retry" onClick={() => onBrowserLyrics('Allow')}>
              Look up lyrics
            </button>
            <button type="button" className="lyrics-placeholder-retry is-secondary" onClick={() => onBrowserLyrics('Deny')}>
              Don't look up
            </button>
          </div>
        ) : null}

        {onRetry ? (
          <button type="button" className="lyrics-placeholder-retry" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </output>
    </div>
  );
}

function getPlaceholderLabel(
  state: LyricsPlaceholderState,
  notFoundReason: NotFoundReason | null,
) {
  switch (state) {
    case 'booting':
      return 'Looking for your music player';
    case 'idle':
      return 'Play a song to see its lyrics';
    case 'loading':
      return 'Loading lyrics';
    case 'consent':
      return 'Look up lyrics for media playing in your browser?';
    case 'unsynced':
      return 'No synced lyrics · Plain lyrics in main window';
    case 'empty':
      return notFoundReason === 'LookupDisabled'
        ? 'Lyrics lookup is off for browser media'
        : 'No synced lyrics for this track';
    case 'error':
      switch (notFoundReason) {
        case 'NetworkError':
          return "Couldn't reach lyric server";
        case 'RateLimit':
          return 'Lyric server busy — backing off';
        default:
          return 'Lyrics unavailable';
      }
    default:
      return '';
  }
}
