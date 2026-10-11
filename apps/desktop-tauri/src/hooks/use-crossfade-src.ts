import { useCallback, useEffect, useState } from 'react';

type Layers = {
  current: string;
  /** Outgoing image, kept underneath until the incoming one has faded in. */
  previous: string | null;
  /** Changes per swap so the incoming <img> remounts and replays its fade. */
  id: number;
};

/**
 * Crossfade between image sources. The incoming image is decoded before it
 * is shown, so the swap never flashes a blank or half-loaded frame; the
 * outgoing image stays underneath until `onEntered` reports the fade is done.
 */
export function useCrossfadeSrc(src: string) {
  const [layers, setLayers] = useState<Layers>({ current: src, previous: null, id: 0 });
  const shown = layers.current;

  useEffect(() => {
    if (src === shown) return;
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img.decode()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setLayers((current) => (
          current.current === src
            ? current
            : { current: src, previous: current.current, id: current.id + 1 }
        ));
      });
    return () => {
      cancelled = true;
    };
  }, [shown, src]);

  const onEntered = useCallback(() => {
    setLayers((current) => (current.previous === null ? current : { ...current, previous: null }));
  }, []);

  return { ...layers, onEntered };
}
