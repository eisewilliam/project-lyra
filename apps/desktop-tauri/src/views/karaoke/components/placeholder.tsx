import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';
import { getCompactPlaceholderLabel } from '@/utils/lyrics-placeholder-labels';
import type { LyricsPlaceholderState } from '@/utils/lyrics-state';

export function KaraokePlaceholder({
  state,
  lines,
}: Readonly<{
  state: LyricsPlaceholderState;
  lines: number;
}>) {
  const loading = state === 'booting' || state === 'loading';
  const statusLabel = state === 'unsynced' ? 'Plain lyrics only' : getCompactPlaceholderLabel(state);
  const compact = lines <= 1;

  return (
    <output
      className={`karaoke-placeholder is-${state} ${loading ? 'is-loading' : ''} ${compact ? 'is-compact' : ''}`}
      aria-label={getCompactPlaceholderLabel(state)}
    >
      <span className="karaoke-placeholder-orb" aria-hidden="true">
        <span className="karaoke-placeholder-ring" />
        <span className="karaoke-placeholder-core">
          <LyricsPlaceholderIcon state={state} className="karaoke-placeholder-icon" />
        </span>
      </span>
      {loading ? (
        <span className="karaoke-placeholder-dots" aria-hidden="true">
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
        </span>
      ) : (
        <span className="karaoke-placeholder-label">{statusLabel}</span>
      )}
    </output>
  );
}
