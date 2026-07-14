import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';
import { getCompactPlaceholderLabel } from '@/utils/lyrics-placeholder-labels';
import type { LyricsPlaceholderState, NotFoundReason } from '@/utils/lyrics-state';

export function PanelPlaceholder({
  state,
  notFoundReason,
}: Readonly<{
  state: LyricsPlaceholderState;
  notFoundReason?: NotFoundReason | null | undefined;
}>) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <output
      className={`panel-placeholder is-${state} ${loading ? 'is-loading' : ''}`}
      aria-label={getCompactPlaceholderLabel(state, notFoundReason)}
    >
      <span className="panel-placeholder-indicator" aria-hidden="true">
        <LyricsPlaceholderIcon state={state} notFoundReason={notFoundReason} className="panel-placeholder-icon" />
      </span>
      <span className="panel-placeholder-lines" aria-hidden="true">
        <span className="panel-placeholder-line primary" />
        <span className="panel-placeholder-line secondary" />
      </span>
    </output>
  );
}
