const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

const FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "5 minutes ago", "yesterday"; "just now" under a minute. */
export function timeAgo(ms: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - ms);
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return FORMAT.format(-Math.floor(elapsed / size), unit);
  }
  return 'just now';
}
