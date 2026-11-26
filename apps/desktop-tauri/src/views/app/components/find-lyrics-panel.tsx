import { useEffect, useMemo, useRef, useState } from 'react';
import type { LineRef } from '../types';
import { formatMs } from '../utils';

export function FindLyricsPanel({
  closing = false,
  lyrics,
  focusRequest,
  plainLyrics,
  canSeek,
  onSeek,
  onClose,
}: Readonly<{
  closing?: boolean;
  lyrics: ReadonlyArray<LineRef>;
  focusRequest: number;
  plainLyrics: string | null;
  canSeek: boolean;
  onSeek: (index: number, timestamp: number) => void;
  onClose: () => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const term = query.trim();
  const jumpEnabled = canSeek && lyrics.length > 0;
  const lines = useMemo(() => plainLyrics !== null
    ? plainLyrics.split(/\r?\n/).map((text) => ({ text, start_ms: null }))
    : lyrics, [lyrics, plainLyrics]);
  const matches = useMemo(() => {
    if (!term) return [];
    const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu');
    return lines.flatMap((line, index) => {
      const parts = line.text.split(pattern);
      return parts.length > 1 ? [{ index, startMs: line.start_ms, parts }] : [];
    });
  }, [lines, term]);

  useEffect(() => {
    if (closing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [closing, focusRequest]);

  const jumpTo = (index: number, timestamp: number) => {
    if (closing) return;
    onClose();
    onSeek(index, timestamp);
  };

  return (
    <div
      className={closing ? 'lyrics-find is-closing' : 'lyrics-find'}
      role="search"
      aria-label="Find in lyrics"
      aria-hidden={closing || undefined}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (closing) return;
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (jumpEnabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          const rows = Array.from(resultsRef.current?.querySelectorAll('button') ?? []);
          if (!rows.length) return;
          const index = rows.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'ArrowDown'
            ? Math.min(index + 1, rows.length - 1)
            : index < 0 ? rows.length - 1 : index - 1;
          event.preventDefault();
          (next < 0 ? inputRef.current : rows[next])?.focus();
        } else if (event.key === 'Enter' && event.target === inputRef.current && jumpEnabled && matches[0]) {
          event.preventDefault();
          jumpTo(matches[0].index, event.timeStamp);
        }
      }}
    >
      <div className="lyrics-find-bar">
        <input
          ref={inputRef}
          type="search"
          className="chooser-field"
          aria-label="Find in lyrics"
          placeholder="Find in lyrics…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="sync-done-btn" onClick={onClose}>Done</button>
      </div>
      {term && (
        <p className="lyrics-find-status" role="status">
          {matches.length === 0 ? 'No matching lines' : `${matches.length} matching ${matches.length === 1 ? 'line' : 'lines'}`}
        </p>
      )}
      {matches.length > 0 && (
        <ul ref={resultsRef} className="lyrics-find-matches" aria-label="Matching lines" tabIndex={jumpEnabled ? undefined : 0}>
          {matches.map(({ index, startMs, parts }) => {
            const content = (
              <>
                {startMs !== null && <span className="lyrics-find-time">{formatMs(startMs)}</span>}
                <span>{parts.map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part)}</span>
              </>
            );
            return (
              <li key={index}>
                {jumpEnabled ? (
                  <button type="button" className="lyrics-find-match" onClick={(event) => jumpTo(index, event.timeStamp)}>
                    {content}
                  </button>
                ) : <div className="lyrics-find-match">{content}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
