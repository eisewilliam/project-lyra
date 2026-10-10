import type { BrowserLyrics, IgnoredMedia } from '@/types/tauri-contracts';
import { IGNORE_REASON_LABELS, mediaSourceLabel } from '@/utils/media-labels';
import {
  type LyricsPlaceholderState,
  type NotFoundReason,
} from '@/utils/lyrics-state';
import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';

export function LyricsPlaceholder({
  state,
  notFoundReason,
  onRetry,
  onBrowserLyrics,
  ignored,
  onFollowIgnored,
  onFollowAutomatically,
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
}>) {
  const loading = state === 'booting' || state === 'loading';
  const ignoredNow = state === 'idle' ? ignored ?? null : null;
  const label = ignoredNow
    ? `Not following “${ignoredNow.title}”`
    : getPlaceholderLabel(state, notFoundReason ?? null);

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
      return 'Waiting for playback';
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
