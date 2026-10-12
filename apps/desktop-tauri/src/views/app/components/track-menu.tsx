import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type TrackMenuItem = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  /** Trailing state or shortcut, e.g. the current delay or ⌘,. */
  detail?: string | undefined;
  /** Second line saying what the action does, or why it is unavailable. */
  hint?: string | undefined;
  disabled?: boolean | undefined;
  onSelect: () => void;
}>;

type FocusTarget = 'first' | 'last' | 'menu';

const MENU_GAP_PX = 10;
const WINDOW_MARGIN_PX = 8;

/** A web menu cannot draw outside the window, so it goes where it fits:
 * above the button, else below it, else (in a short window) shifted to stay
 * inside, over the button, as a native menu does near a screen edge. One
 * taller than the window scrolls. */
function placePanel(panel: HTMLElement, anchor: HTMLElement) {
  panel.style.maxHeight = '';
  const viewport = window.innerHeight;
  const room = viewport - 2 * WINDOW_MARGIN_PX;
  const height = Math.min(panel.offsetHeight, room);
  if (panel.offsetHeight > room) panel.style.maxHeight = `${room}px`;

  const box = anchor.getBoundingClientRect();
  const above = box.top - MENU_GAP_PX - height;
  const below = box.bottom + MENU_GAP_PX;
  let top: number;
  let placement: 'above' | 'below' | 'over';
  if (above >= WINDOW_MARGIN_PX) {
    top = above;
    placement = 'above';
  } else if (below + height <= viewport - WINDOW_MARGIN_PX) {
    top = below;
    placement = 'below';
  } else {
    const preferred = box.top > viewport - box.bottom ? above : below;
    top = Math.min(Math.max(preferred, WINDOW_MARGIN_PX), viewport - WINDOW_MARGIN_PX - height);
    placement = 'over';
  }
  // Absolute within the anchor, so transformed ancestors do not matter.
  panel.style.top = `${top - box.top}px`;
  panel.dataset.placement = placement;
}

/** The track "···" menu: a menu button and an ARIA menu that opens above it.
 * A native <select> could not show icons, groups or trailing state. */
export function TrackMenu({
  groups,
  disabled,
}: Readonly<{
  groups: ReadonlyArray<ReadonlyArray<TrackMenuItem>>;
  disabled: boolean;
}>) {
  const [open, setOpen] = useState<FocusTarget | null>(null);
  // A menu for a track that went away closes with it, and stays closed.
  if (disabled && open) setOpen(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `track-menu-${useId().replaceAll(':', '')}`;

  const enabledItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  const close = (restoreFocus: boolean) => {
    setOpen(null);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = menuRef.current;
    const root = rootRef.current;
    if (panel && root) placePanel(panel, root);
    const items = enabledItems();
    const target = open === 'first' ? items[0] : open === 'last' ? items.at(-1) : menuRef.current;
    target?.focus({ preventScroll: true });
  }, [open]);

  // Light dismiss: a press elsewhere, the window losing focus or resizing
  // (which would leave the panel where it no longer fits) closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const dismiss = () => setOpen(null);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const moveFocus = (step: 1 | -1 | 'first' | 'last') => {
    const items = enabledItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (step === 'first') next = 0;
    else if (step === 'last') next = items.length - 1;
    else if (current === -1) next = step === 1 ? 0 : items.length - 1;
    else next = (current + step + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  const typeahead = (key: string) => {
    const items = enabledItems();
    const start = items.indexOf(document.activeElement as HTMLElement) + 1;
    const ordered = [...items.slice(start), ...items.slice(0, start)];
    ordered.find((item) => item.textContent?.trim().toLowerCase().startsWith(key))?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        moveFocus(1);
        break;
      case 'ArrowUp':
        moveFocus(-1);
        break;
      case 'Home':
        moveFocus('first');
        break;
      case 'End':
        moveFocus('last');
        break;
      case 'Enter':
      case ' ': {
        const active = document.activeElement as HTMLElement | null;
        if (active?.getAttribute('role') === 'menuitem') active.click();
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        // No submenus; keep these from seeking playback.
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        // Focus returns to the button, and Tab carries on from there.
        close(true);
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          typeahead(event.key.toLowerCase());
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const select = (item: TrackMenuItem, fromKeyboard: boolean) => {
    if (item.disabled) return;
    close(fromKeyboard);
    item.onSelect();
  };

  return (
    <div className="track-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`track-action-btn${open ? ' active' : ''}`}
        aria-label="Track actions"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        // A keyboard press arrives as a click with no detail; it opens on the
        // first item, a pointer press on the menu itself.
        onClick={(event) => (open ? close(false) : setOpen(event.detail === 0 ? 'first' : 'menu'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(event.key === 'ArrowDown' ? 'first' : 'last');
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Track actions"
          tabIndex={-1}
          className="track-menu-panel"
          onKeyDown={onMenuKeyDown}
          // Like a native menu, the highlight leaves with the pointer.
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') menuRef.current?.focus({ preventScroll: true });
          }}
        >
          {groups.map((group, index) => (
            <Fragment key={group.map((item) => item.id).join()}>
              {index > 0 && <div role="separator" className="track-menu-separator" />}
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  className="track-menu-item"
                  onPointerMove={(event) => {
                    if (!item.disabled && document.activeElement !== event.currentTarget) {
                      event.currentTarget.focus({ preventScroll: true });
                    }
                  }}
                  onClick={(event) => select(item, event.detail === 0)}
                >
                  <span className="track-menu-icon" aria-hidden="true">{item.icon}</span>
                  <span className="track-menu-text">
                    <span className="track-menu-label">{item.label}</span>
                    {item.hint && <span className="track-menu-hint">{item.hint}</span>}
                  </span>
                  {item.detail && <span className="track-menu-detail">{item.detail}</span>}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// One outline set on a 24px grid, drawn at 16px so strokes land near 1.3px,
// close to the weight of the menu text.
const iconProps = {
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconTiming() {
  return (
    <svg {...iconProps}>
      <path d="M10 2h4M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg {...iconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** A note struck through; the note is cut back around the stroke so the
 * two never touch. */
export function IconNotMusic() {
  const maskId = `not-music-${useId().replaceAll(':', '')}`;
  return (
    <svg {...iconProps}>
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <path d="M2 2l20 20" stroke="black" strokeWidth="6" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </g>
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...iconProps}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
