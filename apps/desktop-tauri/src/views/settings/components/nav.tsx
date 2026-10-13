import type { ReactNode } from 'react';
import { SETTINGS_SECTION_LABELS } from '../settings-sections';
import type { Section } from '../types';

type NavItem = { id: Section; label: string; icon: ReactNode };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [
      { id: 'general', label: SETTINGS_SECTION_LABELS.general, icon: <IconGeneral /> },
      { id: 'appearance', label: SETTINGS_SECTION_LABELS.appearance, icon: <IconAppearance /> },
      { id: 'players', label: SETTINGS_SECTION_LABELS.players, icon: <IconPlayers /> },
    ],
  },
  {
    header: 'Surfaces',
    items: [
      { id: 'main', label: SETTINGS_SECTION_LABELS.main, icon: <IconMainWindow /> },
      { id: 'island', label: SETTINGS_SECTION_LABELS.island, icon: <IconMarquee /> },
      { id: 'karaoke', label: SETTINGS_SECTION_LABELS.karaoke, icon: <IconKaraoke /> },
      { id: 'touchbar', label: SETTINGS_SECTION_LABELS.touchbar, icon: <IconTouchBar /> },
    ],
  },
];

export function SettingsNav({
  section,
  showTouchBar,
  onSectionChange,
}: Readonly<{
  section: Section;
  /** Only Macs with a Touch Bar list its page. */
  showTouchBar: boolean;
  onSectionChange: (section: Section) => void;
}>) {
  return (
    <aside className="settings-sidebar flex shrink-0 flex-col z-[1]">
      {/* Clears the window controls and doubles as the sidebar's drag handle. */}
      <div className="sidebar-titlebar shrink-0" data-tauri-drag-region="deep" />
      <nav className="flex flex-col" aria-label="Settings sections">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group flex flex-col" key={group.header || 'general-group'}>
            {group.header && <div className="nav-section">{group.header}</div>}
            {group.items.filter((item) => showTouchBar || item.id !== 'touchbar').map((item) => {
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item relative flex w-full items-center text-left ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSectionChange(item.id)}
                >
                  <span className="nav-icon inline-flex shrink-0 items-center justify-center" aria-hidden="true">
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

// Soft monochrome outlines in the text colour: a 24 px grid drawn at 18 px,
// round caps and joins, and corners of at least 4 units so no edge reads as
// sharp at sidebar size. The three surfaces share one rounded frame.
const glyph = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
} as const;

/** Two sliders: system behaviour and preferences. */
function IconGeneral() {
  return (
    <svg {...glyph}>
      <path d="M4 8h8.5M17.5 8H20M4 16h2.5M11.5 16H20" />
      <circle cx="15" cy="8" r="2.5" />
      <circle cx="9" cy="16" r="2.5" />
    </svg>
  );
}

/** A fanned swatch book: colour, type and background. */
function IconAppearance() {
  return (
    <svg {...glyph}>
      <path d="M11 16.5a3.5 3.5 0 0 1-7 0V6a2.5 2.5 0 0 1 2.5-2.5h2A2.5 2.5 0 0 1 11 6Z" />
      <path d="M11 8.5l2.4-2.4a2.5 2.5 0 0 1 3.54 0l1.46 1.46a2.5 2.5 0 0 1 0 3.54L10 19.5" />
      <path d="M16 13.5h1.5A2.5 2.5 0 0 1 20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H7.5" />
      <path d="M7.5 16.5h.01" strokeWidth={2.25} />
    </svg>
  );
}

/** Headphones: the players Lyra listens to. */
function IconPlayers() {
  return (
    <svg {...glyph}>
      <path d="M4 17v-4a8 8 0 0 1 16 0v4" />
      <rect x="4" y="13.5" width="4.5" height="7" rx="2.25" />
      <rect x="15.5" y="13.5" width="4.5" height="7" rx="2.25" />
    </svg>
  );
}

/** A window with its title-bar controls. */
function IconMainWindow() {
  return (
    <svg {...glyph}>
      <rect x="3" y="4.5" width="18" height="15" rx="4" />
      <path d="M7 8.5h.01M10 8.5h.01" strokeWidth={2.25} />
    </svg>
  );
}

/** The same frame with a small panel floating inside it. */
function IconMarquee() {
  return (
    <svg {...glyph}>
      <rect x="3" y="4.5" width="18" height="15" rx="4" />
      <rect x="12" y="11.5" width="5.5" height="4.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** A long, low strip with two controls on it, like the bar itself. */
function IconTouchBar() {
  return (
    <svg {...glyph}>
      <rect x="2" y="8" width="20" height="8" rx="4" />
      <path d="M6.5 12h.01M10 12h7.5" strokeWidth={2} />
    </svg>
  );
}

/** The same frame with lyric lines across its lower half, like subtitles. */
function IconKaraoke() {
  return (
    <svg {...glyph}>
      <rect x="3" y="4.5" width="18" height="15" rx="4" />
      <path d="M7 12.5h3M13 12.5h4M7 15.75h6M16 15.75h1" />
    </svg>
  );
}
