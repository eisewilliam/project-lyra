/**
 * Lyra's play/pause mark. Two bars (pause) fold into a triangle (play) by
 * animating each half's clip-path — the same shape family as the island's
 * meter bars, so the meter, the island control and the main play button read
 * as one object changing state. Styles live in `index.css`.
 */
export function TransportGlyph({
  playing,
  className = '',
}: Readonly<{
  /** Show pause while playing, play while paused. */
  playing: boolean;
  className?: string;
}>) {
  return (
    <span className={`transport-glyph ${className}`} data-playing={playing} aria-hidden="true">
      <span className="transport-glyph-half is-left" />
      <span className="transport-glyph-half is-right" />
    </span>
  );
}
