import type { LyricsPlaceholderState } from '@/utils/lyrics-state';

export function getCompactPlaceholderLabel(state: LyricsPlaceholderState) {
  switch (state) {
    case 'booting':
      return 'Looking for your music player';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'consent':
      return 'Allow lyrics for browser media in the main window';
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
