import { TransportGlyph } from '@/components/transport-glyph';
import type { ShortcutFeedback, ShortcutHudState } from '../hooks/use-shortcut-hud';

const LABELS: Record<ShortcutFeedback, string> = {
  play: 'Play',
  pause: 'Pause',
  forward: '+5 s',
  back: '−5 s',
  next: 'Next',
  previous: 'Previous',
};

function HudIcon({ kind }: Readonly<{ kind: ShortcutFeedback }>) {
  if (kind === 'play' || kind === 'pause') {
    // Pause shows the bars, play shows the triangle.
    return <TransportGlyph playing={kind === 'pause'} className="shortcut-hud-glyph" />;
  }
  const flip = kind === 'back' || kind === 'previous' ? 'scale(-1, 1)' : undefined;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ transform: flip }} aria-hidden="true">
      {kind === 'next' || kind === 'previous'
        ? <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        : <path d="M4 18l8.5-6L4 6v12zm9 0l8.5-6L13 6v12z" />}
    </svg>
  );
}

/** Brief confirmation for keyboard shortcuts (see `useShortcutHud`). */
export function ShortcutHud({ hud }: Readonly<{ hud: ShortcutHudState | null }>) {
  if (!hud) return null;
  return (
    <div key={hud.id} className="shortcut-hud" role="status">
      <HudIcon kind={hud.kind} />
      <span>{LABELS[hud.kind]}</span>
    </div>
  );
}
