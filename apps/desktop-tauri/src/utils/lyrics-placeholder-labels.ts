import type { LyricsPlaceholderState, NotFoundReason } from '@/utils/lyrics-state';

export function getCompactPlaceholderLabel(
  state: LyricsPlaceholderState,
  notFoundReason: NotFoundReason | null = null,
) {
  switch (state) {
    case 'booting':
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'empty':
      switch (notFoundReason) {
        case 'Instrumental':
          return 'Instrumental';
        case 'Classical':
          return 'Classical Music';
        case 'Soundtrack':
          return 'Soundtrack / Score';
        default:
          return 'No synced lyrics';
      }
    case 'error':
      return 'Lyrics unavailable';
    default:
      return '';
  }
}
