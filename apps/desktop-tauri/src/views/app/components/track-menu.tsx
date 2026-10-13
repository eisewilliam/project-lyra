import { useRef, useState } from 'react';
import { showMenu, type MenuGroups } from '@/utils/native-menu';

/** Space between the button and the menu, as under a toolbar pull-down. */
const MENU_GAP_PX = 4;

const noop = () => {};

/**
 * The track "···" button and its menu. The menu is the system's own, like
 * the lyric line menu: the platform draws, highlights and dismisses it,
 * handles the keyboard and VoiceOver, and lets it reach past the window's
 * edge. It is built per open, so it always reflects the current track, and
 * drops down from the button like a toolbar pull-down.
 */
export function TrackMenu({
  groups,
  disabled,
}: Readonly<{
  groups: MenuGroups;
  disabled: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A mouse opens the menu on press, as a native pull-down does; the click
  // that may follow the release must not open it a second time.
  const pressedRef = useRef(false);

  const show = async () => {
    const button = buttonRef.current;
    if (!button || open || disabled) return;
    const box = button.getBoundingClientRect();
    setOpen(true);
    try {
      // Resolves once the menu closes, so the button stays pressed meanwhile.
      await showMenu(groups, { x: box.left, y: box.bottom + MENU_GAP_PX });
    } finally {
      setOpen(false);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`track-action-btn${open ? ' active' : ''}`}
      aria-label="Track actions"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        event.preventDefault();
        pressedRef.current = true;
        show().catch(noop);
      }}
      onClick={(event) => {
        // A keyboard press arrives as a click with no detail.
        const fromPointerPress = pressedRef.current && event.detail !== 0;
        pressedRef.current = false;
        if (!fromPointerPress) show().catch(noop);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          show().catch(noop);
        }
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
    </button>
  );
}
