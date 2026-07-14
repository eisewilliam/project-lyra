import {
  type LyricsPlaceholderState,
  type NotFoundReason,
} from '@/utils/lyrics-state';
import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';

export function LyricsPlaceholder({
  state,
  notFoundReason,
  onRetry,
}: Readonly<{
  state: LyricsPlaceholderState;
  notFoundReason?: NotFoundReason | null | undefined;
  onRetry?: () => void;
}>) {
  const loading = state === 'booting' || state === 'loading';
  const label = getPlaceholderLabel(state, notFoundReason ?? null);

  return (
    <div className={`lyrics-placeholder is-${state} ${loading ? 'is-loading' : ''}`}>
      <output className="lyrics-placeholder-card" aria-label={label}>
        <div className="lyrics-placeholder-orb" aria-hidden="true">
          <span className="lyrics-placeholder-ring" />
          <span className="lyrics-placeholder-core">
            <LyricsPlaceholderIcon state={state} notFoundReason={notFoundReason} className="lyrics-placeholder-icon" />
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
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'empty':
      switch (notFoundReason) {
        case 'Instrumental':
          return 'Instrumental';
        case 'Classical':
          return 'Classical Music';
        case 'Soundtrack':
          return 'Soundtrack / Score';
        default:
          return 'No synced lyrics for this track';
      }
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
