import type { LyricsStatus, NotFoundReason } from '@/types/tauri-contracts';

export type { LyricsStatus, NotFoundReason };

export type LyricsPlaceholderState =
  | 'booting'
  | 'idle'
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready'
  | 'unsynced';

export function isLyricsError(status: LyricsStatus): status is { Error: string } {
  return typeof status === 'object' && status !== null && 'Error' in status;
}

export function getLyricsError(status: LyricsStatus): string | null {
  return isLyricsError(status) ? status.Error : null;
}

export function isLyricsNotFound(
  status: LyricsStatus,
): status is { NotFound: { reason: NotFoundReason } } {
  return typeof status === 'object' && status !== null && 'NotFound' in status;
}

export function getNotFoundReason(status: LyricsStatus): NotFoundReason | null {
  return isLyricsNotFound(status) ? status.NotFound.reason : null;
}

export function isRetryableNotFound(status: LyricsStatus): boolean {
  const reason = getNotFoundReason(status);
  return reason === 'NetworkError' || reason === 'RateLimit';
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

  if (isLyricsNotFound(lyricsStatus)) {
    return isRetryableNotFound(lyricsStatus) ? 'error' : 'empty';
  }

  if (lyricsStatus === 'Unsynced') return 'unsynced';

  if (!hasContent) {
    return 'loading';
  }

  return 'ready';
}
