import type { PositionBaseline } from '@/utils/playback-sync';

export type TimingClock = { at: number; rate: number; ageMs: number };

export function tapPosition(baseline: PositionBaseline, clock: TimingClock, now: number): number {
  const rate = Number.isFinite(clock.rate) && clock.rate >= 0 ? clock.rate : 1;
  // A local seek installs a new baseline with no snapshot-delivery delay.
  const age = baseline.targetAt === clock.at ? clock.ageMs : 0;
  return baseline.targetMs + (now - baseline.targetAt) * rate + age * (rate - 1);
}

export function lyricLines(text: string): string[] {
  return text.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
}

export function nextStamp(position: number, previous: number | undefined, duration: number): number | null {
  if (!Number.isFinite(position) || position < 0) return null;
  const ms = Math.floor(position / 10) * 10;
  if ((previous !== undefined && ms <= previous) || (duration > 0 && ms > duration)) return null;
  return ms;
}

/** Map raw core/host timing or publish errors into calm plain-language copy. */
export function formatMakerError(cause: unknown): string {
  const message = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : String(cause);
  const lower = message.toLowerCase();

  if (lower.includes('did not confirm publication')) {
    return "LRCLIB didn't confirm publication. Check LRCLIB before trying again.";
  }
  if (lower.includes('declined the challenge') || lower.includes('is busy') || lower.includes('http 429')) {
    return 'The lyric server is busy. Try again in a moment.';
  }
  if (lower.includes('declined publication')) {
    return "LRCLIB couldn't accept these lyrics. Check the track details and try again.";
  }
  if (lower.includes('could not reach')) {
    return "Couldn't reach the lyric server. Try again.";
  }
  if (lower.includes('invalid lrclib') || lower.includes('challenge timed out') || lower.includes('challenge stopped')) {
    return "Couldn't complete LRCLIB verification. Try again.";
  }
  if (lower.includes('publication is already in progress')) {
    return 'Already sharing these lyrics…';
  }
  if (lower.includes('playing track changed')) {
    return 'The playing track changed.';
  }
  if (lower.includes('saved lyrics changed')) {
    return 'The saved lyrics changed. Open them again to share.';
  }
  if (lower.includes('could not save') || lower.includes("couldn't save")) {
    return "Couldn't save synced lyrics.";
  }
  if (lower.includes('title, artist, album')) {
    return 'LRCLIB needs a title, artist, album, and track length.';
  }
  if (lower.includes('later time within the track')) {
    return 'Each line needs a later time within the track.';
  }
  if (lower.includes('too long')) {
    return 'The lyrics are too long to save.';
  }
  if (lower.includes('at least one timed line')) {
    return 'Sync at least one line before saving.';
  }
  if (lower.includes('embedded word timestamps')) {
    return 'Remove embedded word timestamps before saving.';
  }
  return message || "Something went wrong. Try again.";
}
