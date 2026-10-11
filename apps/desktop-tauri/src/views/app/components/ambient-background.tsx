import { memo } from 'react';
import { useCrossfadeSrc } from '@/hooks/use-crossfade-src';

export const AmbientBackground = memo(function AmbientBackground({
  artworkSrc,
  onArtworkError,
}: Readonly<{
  artworkSrc: string;
  onArtworkError: () => void;
}>) {
  const art = useCrossfadeSrc(artworkSrc);
  return (
    <div className="ambient-bg" aria-hidden="true">
      {art.previous && <img className="ambient-previous" src={art.previous} alt="" decoding="async" />}
      <img
        key={art.id}
        className={art.previous ? 'is-entering' : undefined}
        src={art.current}
        alt=""
        decoding="async"
        onError={onArtworkError}
        onAnimationEnd={art.onEntered}
      />
      <div className="ambient-dimmer"></div>
    </div>
  );
});
