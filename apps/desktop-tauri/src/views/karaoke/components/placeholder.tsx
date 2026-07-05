import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';
import { getCompactPlaceholderLabel } from '@/utils/lyrics-placeholder-labels';
import type { LyricsPlaceholderState } from '@/utils/lyrics-state';

export function KaraokePlaceholder({
  state,
  lines,
}: {
  state: LyricsPlaceholderState;
  lines: number;
}) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <div className={`karaoke-placeholder is-${state} ${loading ? 'is-loading' : ''}`} role="status" aria-label={getCompactPlaceholderLabel(state)}>
      <div className="karaoke-placeholder-orb" aria-hidden="true">
        <span className="karaoke-placeholder-ring" />
        <span className="karaoke-placeholder-core">
          <LyricsPlaceholderIcon state={state} className="karaoke-placeholder-icon" />
        </span>
      </div>
      {loading ? (
        <div className="karaoke-placeholder-dots" aria-hidden="true">
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
        </div>
      ) : lines >= 2 ? <div className="karaoke-placeholder-spacer" aria-hidden="true" /> : null}
    </div>
  );
}
