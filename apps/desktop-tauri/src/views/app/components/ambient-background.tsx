export function AmbientBackground({
  artworkSrc,
  onArtworkError,
}: {
  artworkSrc: string;
  onArtworkError: () => void;
}) {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <img src={artworkSrc} alt="" decoding="async" onError={onArtworkError} />
      <div className="ambient-dimmer"></div>
    </div>
  );
}
