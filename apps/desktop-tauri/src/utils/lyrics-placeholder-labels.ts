import type { LyricsPlaceholderState } from '@/utils/lyrics-state';

export function getCompactPlaceholderLabel(state: LyricsPlaceholderState) {
  switch (state) {
    case 'booting':
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'unsynced':
      return 'No synced lyrics · Plain lyrics in main window';
    case 'empty':
      return 'No synced lyrics';
    case 'error':
      return 'Lyrics unavailable';
    default:
      return '';
  }
}
