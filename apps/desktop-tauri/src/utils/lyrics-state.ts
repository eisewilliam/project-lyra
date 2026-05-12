export type LyricsStatus = 'Loading' | 'Ready' | 'NotFound' | { Error: string };

export type LyricsPlaceholderState =
  | 'booting'
  | 'idle'
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready';

export function isLyricsError(status: LyricsStatus): status is { Error: string } {
  return typeof status === 'object' && status !== null && 'Error' in status;
}

export function getLyricsError(status: LyricsStatus): string | null {
  return isLyricsError(status) ? status.Error : null;
}

export function resolveLyricsSurfaceState({
  booted,
  hasTrack,
  lyricsStatus,
  hasContent,
}: {
  booted: boolean;
  hasTrack: boolean;
  lyricsStatus: LyricsStatus;
  hasContent: boolean;
}): LyricsPlaceholderState {
  if (!booted) {
    return 'booting';
  }

  if (!hasTrack) {
    return 'idle';
  }

  if (isLyricsError(lyricsStatus)) {
    return 'error';
  }

  if (lyricsStatus === 'Loading') {
    return 'loading';
  }

  if (lyricsStatus === 'NotFound') {
    return 'empty';
  }

  if (!hasContent) {
    return 'loading';
  }

  return 'ready';
}