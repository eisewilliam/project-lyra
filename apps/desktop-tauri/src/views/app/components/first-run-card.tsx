import { useEffect, useRef } from 'react';

/**
 * Shown once on a fresh macOS install, before Lyra scripts Spotify or Music:
 * macOS asks for Automation permission the first time Lyra does, and that
 * prompt makes more sense after a one-line reason.
 */
export function FirstRunCard({
  closing = false,
  onContinue,
}: Readonly<{
  closing?: boolean;
  onContinue: () => void;
}>) {
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!closing) {
      continueRef.current?.focus({ preventScroll: true });
    }
  }, [closing]);

  return (
    <div
      className={closing ? 'first-run is-closing' : 'first-run'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
      aria-describedby="first-run-body"
      aria-hidden={closing || undefined}
    >
      <div className="first-run-card">
        <h2 id="first-run-title" className="first-run-title">Synced lyrics for what you&rsquo;re playing</h2>
        <p id="first-run-body" className="first-run-body">
          To read the song in Spotify or Apple Music, Lyra asks macOS for permission to control them.
          It only reads what&rsquo;s playing, and plays, pauses or skips when you ask.
        </p>
        <button ref={continueRef} type="button" className="first-run-continue" disabled={closing} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
