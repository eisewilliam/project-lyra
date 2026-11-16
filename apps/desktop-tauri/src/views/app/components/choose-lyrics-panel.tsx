import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  CandidateFit,
  LyricCandidate,
  LyricCandidates,
  LyricChoiceError,
  LyricSearchQuery,
  LyricsOrigin,
} from '@/types/tauri-contracts';
import {
  chooseLyricCandidate,
  importLyricsFile,
  listLyricCandidates,
  resetLyricsChoice,
} from '@/utils/tauri-commands';
import { formatMs, noop } from '../utils';

const FIT_LABELS: Record<CandidateFit, string | null> = {
  good: null,
  weak: 'Loose match',
  other_length: 'Different length',
  other_version: 'Different version',
};

const ERROR_MESSAGES: Record<LyricChoiceError, string> = {
  no_track: 'Nothing is playing.',
  track_changed: 'The song changed.',
  consent_required: 'Searching sends this title and artist to LRCLIB.',
  lookup_disabled: 'Lyric lookups for browser media are off. Turn them on in Settings, or add a lyrics file.',
  network_error: "Couldn't reach the lyric server.",
  rate_limit: 'The lyric server is busy. Try again in a moment.',
  gone: 'Those lyrics are no longer available.',
  empty: 'The file has no lyrics in it.',
  too_large: 'The file is too large to be a lyrics file.',
  not_text: "The file isn't a text or LRC file.",
  unreadable: "The file couldn't be opened.",
  save_failed: "The lyrics couldn't be saved.",
};

/** Differences under this are rounding, not another length. */
const DURATION_NOTE_MS = 3000;

type Search =
  | { state: 'loading' }
  | { state: 'done'; result: LyricCandidates }
  | { state: 'failed'; error: LyricChoiceError };

function asChoiceError(error: unknown): LyricChoiceError {
  return typeof error === 'string' && error in ERROR_MESSAGES ? (error as LyricChoiceError) : 'network_error';
}

/** Choose other lyrics for the playing track: another LRCLIB match, found
 * with the track's own title and artist or a typed search, or a lyrics file.
 * Shown in place of the lyrics; choosing closes it. */
export function ChooseLyricsPanel({
  trackKey,
  trackTitle,
  trackArtist,
  trackDurationMs,
  origin,
  onAllowBrowserLyrics,
  onClose,
}: Readonly<{
  trackKey: string;
  /** Fill the search fields while the first search runs. */
  trackTitle: string;
  trackArtist: string;
  trackDurationMs: number;
  origin: LyricsOrigin;
  /** Answers the browser-media consent question with Allow. */
  onAllowBrowserLyrics: () => Promise<void>;
  onClose: () => void;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchSeq = useRef(0);
  const [search, setSearch] = useState<Search>({ state: 'loading' });
  const [title, setTitle] = useState(trackTitle);
  const [artist, setArtist] = useState(trackArtist);
  const [choosingId, setChoosingId] = useState<number | null>(null);
  const [chooseError, setChooseError] = useState<LyricChoiceError | null>(null);

  // Results apply only if no newer search started meanwhile. They leave the
  // fields alone: the user may already be typing the next search.
  const fetchResults = useCallback((query: LyricSearchQuery | null) => {
    const seq = ++searchSeq.current;
    listLyricCandidates(query)
      .then((result) => {
        if (seq === searchSeq.current) setSearch({ state: 'done', result });
      })
      .catch((error: unknown) => {
        if (seq === searchSeq.current) setSearch({ state: 'failed', error: asChoiceError(error) });
      });
  }, []);

  const runSearch = (query: LyricSearchQuery | null) => {
    setSearch({ state: 'loading' });
    setChooseError(null);
    fetchResults(query);
  };

  // The first search uses the track's own title and artist.
  useEffect(() => {
    fetchResults(null);
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      searchSeq.current += 1;
    };
  }, [fetchResults]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    runSearch(title.trim() ? { title, artist } : null);
  };

  const choose = (candidate: LyricCandidate) => {
    if (candidate.current || choosingId !== null) return;
    setChoosingId(candidate.id);
    setChooseError(null);
    chooseLyricCandidate(trackKey, candidate.id)
      .then(onClose)
      .catch((error: unknown) => setChooseError(asChoiceError(error)))
      .finally(() => setChoosingId(null));
  };

  const addFile = () => {
    importLyricsFile()
      .then((used) => {
        if (used) onClose();
      })
      // The host explains a file it can't use in an alert.
      .catch(noop);
  };

  const useAutomatic = () => {
    resetLyricsChoice()
      .then(onClose)
      .catch((error: unknown) => setChooseError(asChoiceError(error)));
  };

  const allowAndSearch = () => {
    onAllowBrowserLyrics()
      .then(() => runSearch(null))
      .catch(noop);
  };

  // The panel lives inside the lyrics pane: keep its keys and right-clicks
  // away from the pane's line navigation and line menu.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  // Arrow keys move between matches, as in a list.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button.chooser-row') ?? []);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const candidates = search.state === 'done' ? search.result.candidates : [];

  return (
    <div
      ref={panelRef}
      className="chooser"
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.stopPropagation()}
      onFocus={(event) => event.stopPropagation()}
    >
      <div className="chooser-header">
        <h3 id={titleId} className="sync-panel-title">Choose lyrics</h3>
        <div className="sync-panel-header-actions">
          <button type="button" className="sync-text-btn" onClick={addFile}>
            Add lyrics file…
          </button>
          <button type="button" className="sync-done-btn" onClick={onClose}>Done</button>
        </div>
      </div>

      <form className="chooser-search" onSubmit={submitSearch}>
        <input
          className="chooser-field"
          aria-label="Title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <input
          className="chooser-field"
          aria-label="Artist"
          placeholder="Artist"
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="chooser-search-btn" disabled={search.state === 'loading'}>
          Search
        </button>
      </form>

      <div className="chooser-results" aria-busy={search.state === 'loading'}>
        {search.state === 'loading' && (
          <div className="chooser-status" aria-live="polite">
            <span className="chooser-spinner" aria-hidden="true" />
            Searching LRCLIB…
          </div>
        )}

        {search.state === 'failed' && (
          <div className="chooser-status is-error" aria-live="polite">
            <p>{ERROR_MESSAGES[search.error]}</p>
            {search.error === 'consent_required' && (
              <button type="button" className="lyrics-placeholder-retry" onClick={allowAndSearch}>
                Look up lyrics
              </button>
            )}
            {(search.error === 'network_error' || search.error === 'rate_limit') && (
              <button
                type="button"
                className="lyrics-placeholder-retry"
                onClick={() => runSearch(title.trim() ? { title, artist } : null)}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {search.state === 'done' && candidates.length === 0 && (
          <div className="chooser-status" aria-live="polite">
            <p>No lyrics found. Try a shorter title or another spelling of the artist.</p>
          </div>
        )}

        {candidates.length > 0 && (
          <ul ref={listRef} className="chooser-list" aria-label="Matches" onKeyDown={onListKeyDown}>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <CandidateRow
                  candidate={candidate}
                  trackDurationMs={trackDurationMs}
                  choosing={choosingId === candidate.id}
                  disabled={choosingId !== null}
                  onChoose={choose}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {(chooseError || origin.kind !== 'automatic') && (
        <div className="chooser-footer">
          {chooseError ? (
            <p className="chooser-footer-note is-error" role="alert">{ERROR_MESSAGES[chooseError]}</p>
          ) : (
            <p className="chooser-footer-note">{describeOrigin(origin)}</p>
          )}
          {origin.kind !== 'automatic' && (
            <button type="button" className="sync-text-btn" onClick={useAutomatic}>
              Use automatic lyrics
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  trackDurationMs,
  choosing,
  disabled,
  onChoose,
}: Readonly<{
  candidate: LyricCandidate;
  trackDurationMs: number;
  choosing: boolean;
  disabled: boolean;
  onChoose: (candidate: LyricCandidate) => void;
}>) {
  const fitLabel = FIT_LABELS[candidate.fit];
  const meta = [candidate.artist, candidate.album].filter(Boolean).join(' · ');
  let lengthNote: string | null = null;
  if (candidate.duration_ms !== null && trackDurationMs > 0) {
    const diff = candidate.duration_ms - trackDurationMs;
    if (Math.abs(diff) >= DURATION_NOTE_MS) lengthNote = `${diff > 0 ? '+' : '−'}${formatMs(Math.abs(diff))}`;
  }

  return (
    <button
      type="button"
      className={`chooser-row${candidate.current ? ' is-current' : ''}${choosing ? ' is-choosing' : ''}`}
      aria-current={candidate.current || undefined}
      aria-disabled={(disabled && !choosing) || candidate.current || undefined}
      onClick={() => onChoose(candidate)}
    >
      <span className="chooser-row-main">
        <span className="chooser-row-title">{candidate.title || 'Untitled'}</span>
        {meta && <span className="chooser-row-meta">{meta}</span>}
        {candidate.preview.length > 0 && (
          <span className="chooser-row-preview">{candidate.preview.join(' / ')}</span>
        )}
      </span>
      <span className="chooser-row-side">
        {candidate.duration_ms !== null && (
          <span className="chooser-row-duration">
            {formatMs(candidate.duration_ms)}
            {lengthNote && <span className="chooser-row-delta"> ({lengthNote})</span>}
          </span>
        )}
        <span className="chooser-tags">
          {choosing && <span className="chooser-tag">Loading…</span>}
          {candidate.current && <span className="chooser-tag is-current">Showing</span>}
          <span
            className="chooser-tag"
            title={candidate.synced ? undefined : 'No timing: shows in this window only'}
          >
            {candidate.synced ? 'Synced' : 'Plain text'}
          </span>
          {fitLabel && <span className="chooser-tag is-caution">{fitLabel}</span>}
        </span>
      </span>
    </button>
  );
}

function describeOrigin(origin: LyricsOrigin): string {
  if (origin.kind === 'imported') {
    return origin.name ? `Showing lyrics from “${origin.name}”` : 'Showing lyrics from your file';
  }
  return 'Showing lyrics you chose';
}
