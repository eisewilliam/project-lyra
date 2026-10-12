import type { ReactNode } from 'react';
import { SETTINGS_SECTION_LABELS } from '../settings-sections';
import type { Section } from '../types';

type NavItem = { id: Section; label: string; icon: ReactNode };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [
      { id: 'general', label: SETTINGS_SECTION_LABELS.general, icon: <IconGear /> },
      { id: 'appearance', label: SETTINGS_SECTION_LABELS.appearance, icon: <IconAppearance /> },
      { id: 'players', label: SETTINGS_SECTION_LABELS.players, icon: <IconPlayers /> },
    ],
  },
  {
    header: 'Surfaces',
    items: [
      { id: 'main', label: SETTINGS_SECTION_LABELS.main, icon: <IconWindow /> },
      { id: 'island', label: SETTINGS_SECTION_LABELS.island, icon: <IconIsland /> },
      { id: 'karaoke', label: SETTINGS_SECTION_LABELS.karaoke, icon: <IconKaraoke /> },
    ],
  },
];

export function SettingsNav({
  section,
  onSectionChange,
}: Readonly<{
  section: Section;
  onSectionChange: (section: Section) => void;
}>) {
  return (
    <aside className="settings-sidebar flex w-[220px] shrink-0 flex-col box-border p-2.5 z-[1]">
      <div className="sidebar-traffic-spacer h-12 shrink-0" data-tauri-drag-region="deep" />
      <nav className="flex flex-col gap-3" aria-label="Settings sections">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group flex flex-col gap-0.5" key={group.header || 'general-group'}>
            {group.header && <div className="nav-section px-2.5 py-1">{group.header}</div>}
            {group.items.map((item) => {
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSectionChange(item.id)}
                >
                  <span
                    className="nav-icon inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// Monochrome outline glyphs on a 24px grid, drawn at 16px so strokes land
// near 1.2px like the label text; the same set as the track menu.
const glyph = {
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function IconGear() {
  return (
    <svg {...glyph}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Light and dark halves, as in macOS's own Appearance settings. */
function IconAppearance() {
  return (
    <svg {...glyph}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPlayers() {
  return (
    <svg {...glyph}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/** A window, title bar and all, holding lines of lyrics; the title bar sets
 * it apart from the Marquee's screen. */
function IconWindow() {
  return (
    <svg {...glyph}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M2.5 8.5h19M7 12.75h10M7 16h6" />
    </svg>
  );
}

/** The Marquee itself: a capsule with the cover at its left and the lyric
 * line beside it. */
function IconIsland() {
  return (
    <svg {...glyph}>
      <rect x="2" y="6.5" width="20" height="11" rx="5.5" />
      <circle cx="7.5" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M11.5 12h6" />
    </svg>
  );
}

/** A screen with lyrics across its lower edge, like subtitles: where the
 * karaoke overlay sits. */
function IconKaraoke() {
  return (
    <svg {...glyph}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M6.5 13.5h11M8.5 16.75h7" />
    </svg>
  );
}
