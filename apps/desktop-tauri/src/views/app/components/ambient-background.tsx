import { memo } from 'react';

export const AmbientBackground = memo(function AmbientBackground({
  artworkSrc,
  onArtworkError,
}: Readonly<{
  artworkSrc: string;
  onArtworkError: () => void;
}>) {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <img src={artworkSrc} alt="" decoding="async" onError={onArtworkError} />
      <div className="ambient-dimmer"></div>
    </div>
  );
});

