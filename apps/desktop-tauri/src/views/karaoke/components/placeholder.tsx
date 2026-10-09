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
  let secondaryCue = null;
  if (loading) {
    secondaryCue = (
      <span className="karaoke-placeholder-dots" aria-hidden="true">
        <span className="karaoke-placeholder-dot" />
        <span className="karaoke-placeholder-dot" />
        <span className="karaoke-placeholder-dot" />
      </span>
    );
  } else if (lines >= 2) {
    secondaryCue = <span className="karaoke-placeholder-spacer" aria-hidden="true" />;
  }

  return (
    <output className={`karaoke-placeholder is-${state} ${loading ? 'is-loading' : ''}`} aria-label={getCompactPlaceholderLabel(state)}>
      <span className="karaoke-placeholder-orb" aria-hidden="true">
        <span className="karaoke-placeholder-ring" />
        <span className="karaoke-placeholder-core">
          <LyricsPlaceholderIcon state={state} className="karaoke-placeholder-icon" />
        </span>
      </span>
      {state === 'unsynced' && <span>No synced lyrics</span>}
      {secondaryCue}
    </output>
  );
}
