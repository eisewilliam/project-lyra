import { TransportGlyph } from '@/components/transport-glyph';
import type { PlaybackCaps } from '@/types/tauri-contracts';
import { playbackPlayPause } from '@/utils/tauri-commands';
import type { SkipDirection } from '../hooks/use-track-skip';
import { noop } from '../utils';

export function TransportControls({
  caps,
  isPlaying,
  togglePlaying,
  onSkip,
}: Readonly<{
  /** Buttons for controls the player does not support are disabled. */
  caps: PlaybackCaps;
  isPlaying: boolean;
  togglePlaying: () => void;
  onSkip: (direction: SkipDirection) => void;
}>) {
  return (
    <div className="transport-controls">
      <button
        className="btn-icon skip"
        aria-label="Previous"
        disabled={!caps.previous}
        onClick={() => onSkip(-1)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
      </button>
      <button
        className="btn-icon play-pause"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        data-playing={isPlaying}
        disabled={!caps.play_pause}
        onClick={() => {
          togglePlaying();
          playbackPlayPause().catch(noop);
        }}
      >
        <TransportGlyph playing={isPlaying} />
      </button>
      <button
        className="btn-icon skip"
        aria-label="Next"
        disabled={!caps.next}
        onClick={() => onSkip(1)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
    </div>
  );
}
