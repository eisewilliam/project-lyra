import type { TrackRef } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import { toggleSurface } from '@/utils/tauri-commands';
import { formatOffsetShort } from '../sync-timing';
import {
  IconNotMusic,
  IconRefresh,
  IconSettings,
  IconTiming,
  TrackMenu,
  type TrackMenuItem,
} from './track-menu';

const noop = () => {};

// The app menu's Settings… item answers ⌘, on macOS only.
const SETTINGS_SHORTCUT = detectHostOs() === 'macos' ? '⌘,' : undefined;

export function TrackInfo({
  hasTrack,
  hasSyncedLyrics,
  lyricOffsetMs,
  onMarkNotMusic,
  onRetryLyrics,
  setShowDelayControl,
  snapshotReady,
  track,
}: Readonly<{
  hasTrack: boolean;
  hasSyncedLyrics: boolean;
  lyricOffsetMs: number;
  /** Stop following this media and remember it is not music. */
  onMarkNotMusic: () => void;
  onRetryLyrics: () => void;
  setShowDelayControl: React.Dispatch<React.SetStateAction<boolean>>;
  snapshotReady: boolean;
  track: TrackRef | null;
}>) {
  const menu: TrackMenuItem[][] = [
    [
      {
        id: 'sync',
        label: 'Sync lyrics…',
        icon: <IconTiming />,
        // Shown only once it differs from the default, so it reads as state.
        detail: hasSyncedLyrics && lyricOffsetMs !== 0 ? formatOffsetShort(lyricOffsetMs) : undefined,
        hint: hasSyncedLyrics ? undefined : 'Needs synced lyrics',
        disabled: !hasSyncedLyrics,
        onSelect: () => setShowDelayControl(true),
      },
      { id: 'refresh', label: 'Refresh lyrics', icon: <IconRefresh />, onSelect: onRetryLyrics },
    ],
    [
      {
        id: 'not-music',
        label: 'Mark as not music',
        icon: <IconNotMusic />,
        hint: 'Lyra stops following this track',
        onSelect: onMarkNotMusic,
      },
    ],
    [
      {
        id: 'settings',
        label: 'Settings…',
        icon: <IconSettings />,
        detail: SETTINGS_SHORTCUT,
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
          <>
            <h2 className="track-title" title={track?.title}>{track?.title}</h2>
            <p className="track-artist" title={track?.artist}>{track?.artist}</p>
          </>
        ) : (
          <div className="track-meta-skeleton" aria-hidden="true">
            <span className="track-skeleton-line title" />
            <span className="track-skeleton-line artist" />
          </div>
        )}
      </div>
      <div className="track-actions">
        <TrackMenu groups={menu} disabled={!hasTrack} />
      </div>
    </div>
  );
}
