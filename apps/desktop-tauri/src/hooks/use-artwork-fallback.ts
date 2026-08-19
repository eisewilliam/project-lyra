import { useCallback, useState } from 'react';

type ArtworkFallbackState = {
  resetKey: string;
  error: boolean;
};

export function useArtworkFallback(resetKey: string) {
  const [state, setState] = useState<ArtworkFallbackState>({ resetKey, error: false });

  const setArtworkError = useCallback((error: boolean) => {
    setState({ resetKey, error });
  }, [resetKey]);

  return {
    artworkError: state.resetKey === resetKey ? state.error : false,
    setArtworkError,
  };
}
