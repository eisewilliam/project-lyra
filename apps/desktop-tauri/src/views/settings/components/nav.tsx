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

function IconAppearance() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 3.5l5 5-10.5 10.5h-4v-4z" />
      <path d="M14 6l2.5 2.5" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.48 8.42 L17.23 8.41 L17.23 11.59 L15.48 11.58 L14.99 12.76 L16.23 13.99 L13.99 16.23 L12.76 14.99 L11.58 15.48 L11.59 17.23 L8.41 17.23 L8.42 15.48 L7.24 14.99 L6.01 16.23 L3.77 13.99 L5.01 12.76 L4.52 11.58 L2.77 11.59 L2.77 8.41 L4.52 8.42 L5.01 7.24 L3.77 6.01 L6.01 3.77 L7.24 5.01 L8.42 4.52 L8.41 2.77 L11.59 2.77 L11.58 4.52 L12.76 5.01 L13.99 3.77 L16.23 6.01 L14.99 7.24 Z" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  );
}

function IconIsland() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="14" height="6" rx="3" />
      <circle cx="7.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <line x1="10.5" y1="8.75" x2="14.5" y2="8.75" strokeWidth="1.25" />
      <line x1="10.5" y1="11.25" x2="13" y2="11.25" strokeWidth="1.25" />
    </svg>
  );
}

function IconKaraoke() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="11" y2="6" />
      <line x1="3" y1="10" x2="9" y2="10" />
      <line x1="3" y1="14" x2="7" y2="14" />
      <path d="M14 3.5v8.2" />
      <path d="M14 3.5l3.5 1v2l-3.5-1" />
      <circle cx="12.5" cy="13.5" r="1.8" />
    </svg>
  );
}

function IconWindow() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
      <line x1="2.5" y1="8" x2="17.5" y2="8" />
      <circle cx="5.5" cy="6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="6" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPlayers() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5V4.5l8-1.5v10" />
      <circle cx="6" cy="14.5" r="2" />
      <circle cx="14" cy="13" r="2" />
    </svg>
  );
}
