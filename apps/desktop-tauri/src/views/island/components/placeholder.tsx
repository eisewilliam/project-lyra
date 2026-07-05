import { LyricsPlaceholderIcon } from '@/utils/lyrics-placeholder-icon';
import { getCompactPlaceholderLabel } from '@/utils/lyrics-placeholder-labels';
import type { LyricsPlaceholderState } from '@/utils/lyrics-state';

export function PanelPlaceholder({ state }: { state: LyricsPlaceholderState }) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <div className={`panel-placeholder is-${state} ${loading ? 'is-loading' : ''}`} role="status" aria-label={getCompactPlaceholderLabel(state)}>
      <span className="panel-placeholder-indicator" aria-hidden="true">
        <LyricsPlaceholderIcon state={state} className="panel-placeholder-icon" />
      </span>
      <span className="panel-placeholder-lines" aria-hidden="true">
        <span className="panel-placeholder-line primary" />
        <span className="panel-placeholder-line secondary" />
      </span>
    </div>
  );
}
