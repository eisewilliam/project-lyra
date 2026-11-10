import { useRef } from 'react';
import { SettingsSkeleton } from '@/components/settings-controls';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import { detectHostOs } from '@/utils/os';
import { Body, PinnedPreview } from './components/body';
import { SettingsNav } from './components/nav';
import { SettingsWinControls } from './components/win-controls';
import { useScrollEdges } from './hooks/use-scroll-edges';
import { useSettings } from './hooks/use-settings';
import { useSidebarGlass } from './hooks/use-sidebar-glass';
import { useTouchBarSupport } from './hooks/use-touch-bar-support';
import { SETTINGS_SECTION_LABELS } from './settings-sections';
import type { Section } from './types';
import './settings.css';

const isWindows = detectHostOs() === 'windows';

export default function Settings() {
  const {
    state,
    section: requested,
    setSection,
    autostartEnabled,
    monitors,
    artworkSrc,
    actions,
  } = useSettings();
  const touchBar = useTouchBarSupport();
  const hasTouchBar = touchBar?.present ?? false;

  // The Touch Bar page exists only on Macs that have one.
  const section = requested === 'touchbar' && touchBar && !touchBar.present ? 'general' : requested;
  const activeLabel = SETTINGS_SECTION_LABELS[section];
  const paneRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarGlass = useSidebarGlass(shellRef, sidebarRef);
  const edges = useScrollEdges(paneRef, state ? section : null);

  // A new section starts at its top, like a native settings window.
  const changeSection = (next: Section) => {
    if (next === section) return;
    if (paneRef.current) paneRef.current.scrollTop = 0;
    setSection(next);
  };

  const artworkSrcUrl = artworkSrc || TRANSPARENT_FALLBACK_ART;

  return (
    <div
      ref={shellRef}
      className="settings-shell fixed inset-0 flex overflow-hidden select-none"
      data-sidebar-glass={sidebarGlass ? '' : undefined}
    >
      <div className="settings-ambient-bg absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <img src={artworkSrcUrl} alt="" decoding="async" key={artworkSrcUrl} />
        <div className="settings-ambient-dimmer absolute inset-0"></div>
      </div>
      {isWindows && <SettingsWinControls />}
      <SettingsNav
        ref={sidebarRef}
        section={section}
        showTouchBar={hasTouchBar}
        onSectionChange={changeSection}
      />

      <main className="settings-pane flex min-w-0 flex-1 flex-col z-[1]">
        {/* Title and any preview stay put; only the settings below scroll.
            A hairline appears once content passes under them, and above the
            footer while there is more below. */}
        <div className={`pane-top shrink-0 ${edges.above ? 'is-scrolled' : ''}`}>
          <header className="pane-header" data-tauri-drag-region="deep">
            <h1 className="m-0">{activeLabel}</h1>
          </header>
          {state && (
            <div key={section} className="pane-pinned settings-section">
              <PinnedPreview section={section} state={state} artworkSrc={artworkSrcUrl} />
            </div>
          )}
        </div>
        <div ref={paneRef} className="pane-body min-h-0 flex-1 overflow-y-auto">
          {/* Keyed so a new section fades in briefly; the old one is replaced at
              once rather than faded out to an empty pane first. */}
          {state ? (
            <div key={section} className={`settings-section section-${section}`}>
              <Body
                section={section}
                state={state}
                actions={actions}
                activeLabel={activeLabel}
                autostartEnabled={autostartEnabled}
                monitors={monitors}
                artworkSrc={artworkSrcUrl}
                touchBar={touchBar}
              />
            </div>
          ) : (
            <SettingsSkeleton />
          )}
        </div>
        <footer className={`pane-footer shrink-0 ${edges.below ? 'has-more' : ''}`}>Changes apply immediately.</footer>
      </main>
    </div>
  );
}
