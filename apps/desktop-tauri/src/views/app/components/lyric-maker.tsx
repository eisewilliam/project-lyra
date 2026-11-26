import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { publishTimedLyrics, saveTimedLyrics } from '@/utils/tauri-commands';
import { formatMakerError, lyricLines, nextStamp, tapPosition, type TimingClock } from '../lyric-maker';
import { formatMs } from '../utils';
import './lyric-maker.css';

type Stage = 'text' | 'timing' | 'saved' | 'published';

export function LyricMaker({
  track,
  trackMatches,
  plain,
  alreadySaved,
  playing,
  hasPosition,
  baseline,
  timingClock,
  onDirtyChange,
  onClose,
}: Readonly<{
  track: TrackRef;
  trackMatches: boolean;
  plain: string;
  alreadySaved: boolean;
  playing: boolean;
  hasPosition: boolean;
  baseline: RefObject<PositionBaseline>;
  timingClock: RefObject<TimingClock>;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
}>) {
  const titleId = useId();
  const promptId = useId();
  const textAreaId = useId();
  const [stage, setStage] = useState<Stage>(alreadySaved ? 'saved' : 'text');
  const [draft, setDraft] = useState(plain);
  const [lines, setLines] = useState<string[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [tapSeq, setTapSeq] = useState(0);
  const [spacePressed, setSpacePressed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const tap = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const doneBtn = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const complete = times.length === lines.length;
  const canStamp = trackMatches && playing && hasPosition && !complete && !busy;
  const canPublish = !!(track.title.trim() && track.artist.trim() && track.album?.trim() && track.duration_ms > 0);
  const progress = lines.length > 0 ? times.length / lines.length : 0;
  const isDirty = stage === 'timing' || (stage === 'text' && draft !== plain);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (discard) keep.current?.focus();
    else if (stage === 'text') field.current?.focus();
    else if (stage === 'timing' && !complete) tap.current?.focus();
    else if (stage === 'published') doneBtn.current?.focus();
    else primary.current?.focus();
  }, [stage, complete, discard]);

  function close() {
    if (busy) return;
    if (isDirty) setDiscard(true);
    else onClose();
  }

  function shakeTapButton() {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.documentElement.dataset.lowPower === 'true') return;
    tap.current?.animate(
      [
        { transform: 'translateX(0px)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0px)' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  function stamp() {
    if (!canStamp) return;
    const ms = nextStamp(tapPosition(baseline.current, timingClock.current, performance.now()), times.at(-1), track.duration_ms);
    if (ms === null) {
      setError('Wait until the previous line has passed, or undo the last tap.');
      shakeTapButton();
      return;
    }
    setError('');
    setTapSeq((n) => n + 1);
    setTimes([...times, ms]);
  }

  function undoLastTime() {
    if (!times.length || busy) return;
    setTimes(times.slice(0, -1));
    setError('');
    requestAnimationFrame(() => tap.current?.focus());
  }

  async function submit(publish: boolean) {
    if (running.current || !trackMatches) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (publish) {
        await publishTimedLyrics(track.uri);
        setStage('published');
      } else {
        await saveTimedLyrics(track.uri, lines.map((text, i) => ({ text, start_ms: times[i]! })));
        setStage('saved');
      }
    } catch (cause) {
      setError(formatMakerError(cause));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  let heading = 'Sync lyrics';
  if (stage === 'saved') heading = 'Saved on this device';
  else if (stage === 'published') heading = 'Shared to LRCLIB';

  let tapPrompt = 'Tap or press Space when this line begins.';
  if (!trackMatches) tapPrompt = 'Return to this track to continue syncing.';
  else if (!hasPosition) tapPrompt = 'Waiting for the player to report its position.';
  else if (!playing) tapPrompt = 'Play the track to start tapping.';

  const lastStampedMs = times.length > 0 ? times[times.length - 1] : undefined;
  const lastStampedLine = times.length > 0 ? lines[times.length - 1] : undefined;

  return (
    <section
      className="lyric-maker"
      aria-labelledby={titleId}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (stage === 'timing' && !busy && times.length > 0) {
          const isUndoCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
          const isBackspace = event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey;
          if (isUndoCombo || isBackspace) {
            event.preventDefault();
            event.stopPropagation();
            undoLastTime();
            return;
          }
        }
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (discard) setDiscard(false);
          else close();
        }
      }}
    >
      <div className="sync-panel-header">
        <h3 id={titleId} className="sync-panel-title">{heading}</h3>
        <div className="sync-panel-header-actions">
          <button
            ref={doneBtn}
            type="button"
            className={stage === 'published' ? 'sync-done-btn' : 'maker-btn-secondary'}
            onClick={close}
            disabled={busy}
          >
            Done
          </button>
        </div>
      </div>

      {!trackMatches && stage !== 'published' && (
        <div className="maker-notice" role="status">
          <p>
            Playback switched away from “{track.title}”. Return to that track to keep syncing or save, or discard this draft.
          </p>
          <div className="maker-actions">
            <button type="button" className="maker-btn-danger" onClick={onClose} disabled={busy}>
              Discard draft
            </button>
          </div>
        </div>
      )}

      {discard ? (
        <div className="maker-discard" role="alertdialog" aria-label="Discard unsaved syncing">
          <p>Discard your unsaved syncing?</p>
          <div className="maker-actions">
            <button ref={keep} type="button" className="sync-done-btn" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button type="button" className="maker-btn-danger" onClick={onClose}>
              Discard
            </button>
          </div>
        </div>
      ) : stage === 'text' ? (
        <>
          <label htmlFor={textAreaId} className="maker-label">
            {plain ? 'Review the lyrics, one line per tap.' : 'Paste the lyrics, one line per tap.'}
          </label>
          <textarea
            id={textAreaId}
            ref={field}
            className="chooser-field maker-textarea"
            value={draft}
            maxLength={512 * 1024}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="maker-actions">
            <button
              type="button"
              className="sync-done-btn"
              disabled={!draft.trim()}
              onClick={() => {
                setLines(lyricLines(draft));
                setStage('timing');
              }}
            >
              Start syncing
            </button>
          </div>
        </>
      ) : stage === 'timing' ? (
        <div key="stage-timing" className="maker-stage">
          <div className="maker-progress" aria-hidden="true">
            <span className="maker-progress-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <p className="maker-status" aria-live="polite">
            {complete ? 'All lines synced.' : `Line ${times.length + 1} of ${lines.length}`}
            {lastStampedMs !== undefined && (
              <span className="sr-only">
                {` — Line ${times.length} synced at ${formatMs(lastStampedMs)}`}
              </span>
            )}
          </p>
          {lastStampedMs !== undefined && lastStampedLine !== undefined && (
            <div key={times.length} className="maker-stamped" aria-hidden="true">
              <span className="maker-stamped-time">{formatMs(lastStampedMs)}</span>
              <span className="maker-stamped-text">{lastStampedLine}</span>
            </div>
          )}
          {!complete && (
            <>
              <p id={promptId} className="maker-label">{tapPrompt}</p>
              <button
                ref={tap}
                type="button"
                className="maker-tap"
                aria-disabled={!canStamp}
                aria-describedby={promptId}
                data-pressed={spacePressed || undefined}
                onPointerDown={(event) => {
                  if (event.isPrimary && event.button === 0) stamp();
                }}
                onClick={(event) => {
                  if (event.detail === 0) stamp();
                }}
                onKeyDown={(event) => {
                  if (event.key === ' ') {
                    event.preventDefault();
                    setSpacePressed(true);
                    if (!event.repeat) stamp();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ') setSpacePressed(false);
                }}
                onBlur={() => setSpacePressed(false)}
              >
                {tapSeq > 0 && <span key={`flash-${tapSeq}`} className="maker-tap-flash" aria-hidden="true" />}
                <span className="maker-tap-prompt" aria-hidden="true">
                  <IconTap />
                  Tap when you hear
                </span>
                <span key={`line-${times.length}`} className="maker-tap-line">{lines[times.length]}</span>
              </button>
              {lines[times.length + 1] && (
                <p className="maker-upcoming" aria-hidden="true">Next: {lines[times.length + 1]}</p>
              )}
            </>
          )}
          <div className="maker-actions">
            <button
              type="button"
              className="maker-btn-secondary"
              disabled={!times.length || busy}
              title="Undo the last tap (Backspace or ⌘Z)"
              onClick={undoLastTime}
            >
              Undo last tap
            </button>
            {complete && (
              <button
                ref={primary}
                type="button"
                className="sync-done-btn"
                disabled={!trackMatches || busy}
                onClick={() => void submit(false)}
              >
                {busy ? 'Saving…' : 'Save synced lyrics'}
              </button>
            )}
          </div>
        </div>
      ) : stage === 'published' ? (
        <p role="status" className="maker-stage">
          Published to LRCLIB.
        </p>
      ) : (
        <div key="stage-saved" className="maker-stage">
          <p>
            {canPublish
              ? `Sharing sends both lyric versions and the recording details for “${track.title}” by ${track.artist} (${track.album}) to LRCLIB’s public database.`
              : 'LRCLIB needs a title, artist, album, and track length to publish.'}
          </p>
          <div className="maker-actions">
            <button
              ref={primary}
              type="button"
              className="sync-done-btn"
              disabled={!trackMatches || !canPublish || busy}
              onClick={() => void submit(true)}
            >
              {busy ? 'Publishing…' : error ? 'Retry sharing to LRCLIB' : 'Share synced lyrics to LRCLIB'}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="maker-error">{error}</p>}
    </section>
  );
}

function IconTap() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="5.5" opacity="0.7" />
      <circle cx="10" cy="10" r="8.5" opacity="0.35" />
    </svg>
  );
}
