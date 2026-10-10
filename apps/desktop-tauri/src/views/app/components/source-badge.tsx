import { SourceIcon } from '@/components/source-icon';
import type { TrackRef } from '@/types/tauri-contracts';
import { mediaSourceLabel, mediaSourceShortName } from '@/utils/media-labels';
import { sourceBrand } from '@/utils/source-brand';
import { playbackRaise } from '@/utils/tauri-commands';
import { noop } from '../utils';

/**
 * Mark on the album art naming where the track plays. When the player
 * can be brought forward, clicking opens it on the current track.
 */
export function SourceBadge({
  track,
  canRaise,
}: Readonly<{
  track: TrackRef;
  canRaise: boolean;
}>) {
  const brand = sourceBrand(track.platform, track.player);
  const playingIn = `Playing in ${mediaSourceLabel(track.player, track.platform)}`;

  if (!canRaise) {
    return (
      <span className="source-badge" role="img" aria-label={playingIn} title={playingIn}>
        <SourceIcon brand={brand} size={16} />
      </span>
    );
  }

  const open = `Open ${mediaSourceShortName(track.player, track.platform)}`;
  return (
    <button
      type="button"
      className="source-badge"
      aria-label={open}
      title={`${playingIn}. Click to open.`}
      onClick={() => playbackRaise().catch(noop)}
    >
      <SourceIcon brand={brand} size={16} />
    </button>
  );
}
