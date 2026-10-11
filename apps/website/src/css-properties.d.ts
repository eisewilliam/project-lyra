import 'react';

// Inline styles set CSS custom properties (`--song-a`, `--overlay-bg`, …),
// which React passes through but its style types do not list.
declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
