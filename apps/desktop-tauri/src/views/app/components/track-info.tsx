import { useState, type RefObject } from 'react';
import type { LyricsOrigin, TrackRef } from '@/types/tauri-contracts';
import type { MenuGroups } from '@/utils/native-menu';
import { detectHostOs } from '@/utils/os';
import { toggleSurface } from '@/utils/tauri-commands';
import type { SkipDirection } from '../hooks/use-track-skip';
import { describeOffset, formatOffsetShort } from '../sync-timing';
import { describeLyricsOrigin } from '../utils';
import { TrackMenu } from './track-menu';

const noop = () => {};

// Only macOS menus take symbols and second lines; elsewhere the sync offset
// goes in the title instead.
const isMac = detectHostOs() === 'macos';

export function TrackInfo({
  hasTrack,
  hasSyncedLyrics,
  lyricOffsetMs,
  lyricsOrigin,
  onAddLyricsFile,
  onChooseLyrics,
  onFindLyrics,
  onShareTimed,
  makerOpen,
  onMarkNotMusic,
  onRetryLyrics,
  onSyncLyrics,
  onUseAutomaticLyrics,
  snapshotReady,
  skipDirection = 1,
  track,
  trackActionsRef,
}: Readonly<{
  hasTrack: boolean;
  hasSyncedLyrics: boolean;
  lyricOffsetMs: number;
  lyricsOrigin: LyricsOrigin;
  onAddLyricsFile: () => void;
  onChooseLyrics: () => void;
  makerOpen: boolean;
  onShareTimed: () => void;
  onFindLyrics: (() => void) | null;
  /** Stop following this media and remember it is not music. */
  onMarkNotMusic: () => void;
  onRetryLyrics: () => void;
  onSyncLyrics: () => void;
  onUseAutomaticLyrics: () => void;
  snapshotReady: boolean;
  skipDirection?: SkipDirection;
  track: TrackRef | null;
  trackActionsRef: RefObject<HTMLButtonElement | null>;
}>) {
  const trackUri = track?.uri ?? '';
  const [metaTransition, setMetaTransition] = useState({ uri: trackUri, rev: 0 });
  if (metaTransition.uri !== trackUri) {
    setMetaTransition({ uri: trackUri, rev: metaTransition.rev + 1 });
  }
  const animateMeta = metaTransition.rev > 0;
  // Title case, like native menus. Groups: this track's lyrics, the track,
  // the app. The sync offset shows only once it differs from the original,
  // so it reads as state: as a second line on macOS, in the title elsewhere.
  const offset = hasSyncedLyrics && lyricOffsetMs !== 0 ? lyricOffsetMs : 0;
  let syncHint: string | undefined;
  if (!hasSyncedLyrics) syncHint = 'Needs synced lyrics';
  else if (offset !== 0) syncHint = describeOffset(offset);
  const menu: MenuGroups = [
    [
      {
        id: 'sync',
        label: !isMac && offset !== 0 ? `Adjust Sync (${formatOffsetShort(offset)})…` : 'Adjust Sync…',
        symbol: 'timer',
        hint: syncHint,
        disabled: !hasSyncedLyrics,
        onSelect: onSyncLyrics,
      },
      ...(lyricsOrigin.kind === 'timed' ? [{ id: 'share-timed', label: 'Share Synced Lyrics…', symbol: 'square.and.arrow.up', onSelect: onShareTimed }] : []),
      { id: 'choose', label: 'Choose Lyrics…', symbol: 'text.magnifyingglass', onSelect: onChooseLyrics },
      ...(onFindLyrics ? [{ id: 'find', label: 'Find in Lyrics…', symbol: 'magnifyingglass', onSelect: onFindLyrics }] : []),
      { id: 'add-file', label: 'Add Lyrics File…', symbol: 'doc.badge.plus', onSelect: onAddLyricsFile },
      // The user's own lyrics stay until they go back, so a refresh would
      // change nothing; going back takes its place.
      lyricsOrigin.kind === 'automatic'
        ? { id: 'refresh', label: 'Refresh Lyrics', symbol: 'arrow.clockwise', onSelect: onRetryLyrics }
        : {
          id: 'automatic',
          label: 'Use Automatic Lyrics',
          symbol: 'arrow.uturn.backward',
          hint: describeLyricsOrigin(lyricsOrigin),
          onSelect: onUseAutomaticLyrics,
        },
    ],
    [
      {
        id: 'not-music',
        label: 'Mark as Not Music',
        symbol: 'music.note.slash',
        hint: 'Stops following this track',
        onSelect: onMarkNotMusic,
      },
    ],
    [
      {
        id: 'settings',
        label: 'Settings…',
        // No ⌘, here: it lives in the app menu, and the shortcut column
        // would widen the whole menu for one item.
        symbol: 'gearshape',
        onSelect: () => {
          toggleSurface('settings').catch(noop);
        },
      },
    ],
  ];

  return (
    <div className={`track-info ${hasTrack ? '' : 'is-placeholder'} ${snapshotReady ? '' : 'is-loading'}`}>
      <div className="track-meta">
        {hasTrack ? (
          <div
            key={trackUri}
            className={animateMeta ? `track-meta-text is-entering is-${skipDirection > 0 ? 'next' : 'prev'}` : 'track-meta-text'}
          >
            <h2 className="track-title" title={track?.title}>{track?.title}</h2>
            <p className="track-artist" title={track?.artist}>{track?.artist}</p>
          </div>
        ) : (
          <div className="track-meta-skeleton" aria-hidden="true">
            <span className="track-skeleton-line title" />
            <span className="track-skeleton-line artist" />
          </div>
        )}
      </div>
      <div className="track-actions">
        <TrackMenu buttonRef={trackActionsRef} groups={menu} disabled={!hasTrack || makerOpen} />
      </div>
    </div>
  );
}
