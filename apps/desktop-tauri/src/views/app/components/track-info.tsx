import { useEffect, useRef } from 'react';
import type { TrackRef } from '@/types/tauri-contracts';
import { toggleSurface } from '@/utils/tauri-commands';

const noop = () => {};

export function TrackInfo({
  hasTrack,
  hasSyncedLyrics,
  onRetryLyrics,
  selectValue,
  setSelectValue,
  setShowDelayControl,
  snapshotReady,
  track,
}: Readonly<{
  hasTrack: boolean;
  hasSyncedLyrics: boolean;
  onRetryLyrics: () => void;
  selectValue: string;
  setSelectValue: React.Dispatch<React.SetStateAction<string>>;
  setShowDelayControl: React.Dispatch<React.SetStateAction<boolean>>;
  snapshotReady: boolean;
  track: TrackRef | null;
}>) {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) {
        selectRef.current.blur();
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  const handleTrackActionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const val = event.target.value;
    if (val === 'delay') {
      setShowDelayControl(true);
    } else if (val === 'refresh') {
      onRetryLyrics();
    } else if (val === 'settings') {
      toggleSurface('settings').catch(noop);
    }
    setSelectValue('');
    event.target.blur();
  };

  return (
    <div className={`track-info ${hasTrack ? '' : 'is-placeholder'} ${snapshotReady ? '' : 'is-loading'}`}>
      <div className="track-meta">
        {hasTrack ? (
          <>
            <h2 className="track-title">{track?.title}</h2>
            <p className="track-artist">{track?.artist}</p>
          </>
        ) : (
          <div className="track-meta-skeleton" aria-hidden="true">
            <span className="track-skeleton-line title" />
            <span className="track-skeleton-line artist" />
          </div>
        )}
      </div>
      <div className="track-actions">
        <div className="track-menu">
          {hasTrack && (
            <select
              ref={selectRef}
              className="track-menu-select"
              value={selectValue}
              onChange={handleTrackActionChange}
              aria-label="Track actions"
            >
              <option value="" disabled hidden>Actions</option>
              <option value="delay" disabled={!hasSyncedLyrics}>☰ Lyrics delay</option>
              <option value="refresh">↻ Refresh lyrics</option>
              <option value="settings">⛭ Settings</option>
            </select>
          )}
          <button
            className="track-action-btn"
            aria-label="Options"
            disabled={!hasTrack}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
