import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { SETTINGS_SECTION_LABELS } from '../settings-sections';
import type { Section } from '../types';

type NavItem = { id: Section; label: string; icon: ReactNode };

const NAV_GROUPS: { header: string | null; items: NavItem[] }[] = [
  {
    header: null,
    items: [
      { id: 'general', label: SETTINGS_SECTION_LABELS.general, icon: <IconGear /> },
      { id: 'appearance', label: SETTINGS_SECTION_LABELS.appearance, icon: <IconAppearance /> },
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
      <nav className="flex flex-col gap-4">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group flex flex-col gap-1" key={group.header || 'general-group'}>
            {group.header && <div className="nav-section px-2.5 py-1">{group.header}</div>}
            {group.items.map((item) => {
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  className={`nav-item relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${isActive ? 'active' : ''}`}
                  onClick={() => onSectionChange(item.id)}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-nav-indicator"
                      className="nav-item-indicator"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="nav-icon relative z-10 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                    {item.icon}
                  </span>
                  <span className="nav-label relative z-10">{item.label}</span>
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
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-6.5 2.5c0-.4.04-.78.11-1.16L0 5.6l1.5-2.6 1.7.85a6.5 6.5 0 0 1 2-1.16L5.5 1h3l.3 1.7a6.5 6.5 0 0 1 2 1.15L12.5 3 14 5.6l-1.6 1.24c.07.38.1.76.1 1.16 0 .4-.03.78-.1 1.16L14 10.4 12.5 13l-1.7-.84a6.5 6.5 0 0 1-2 1.15L8.5 15h-3l-.3-1.7a6.5 6.5 0 0 1-2-1.15L1.5 13 0 10.4l1.6-1.24c-.07-.38-.1-.76-.1-1.16Z" />
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
