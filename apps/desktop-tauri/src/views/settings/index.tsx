import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SettingsSkeleton } from '@/components/settings-controls';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import { detectHostOs } from '@/utils/os';
import { Body } from './components/body';
import { SettingsNav } from './components/nav';
import { SettingsWinControls } from './components/win-controls';
import { useSettings } from './hooks/use-settings';
import { SETTINGS_SECTION_LABELS } from './settings-sections';
import './settings.css';

const isWindows = detectHostOs() === 'windows';
const SECTION_EASE = [0.22, 1, 0.36, 1] as const;

export default function Settings() {
  const prefersReducedMotion = useReducedMotion();
  const {
    state,
    section,
    setSection,
    autostartEnabled,
    monitors,
    artworkSrc,
    actions,
  } = useSettings();

  const activeLabel = SETTINGS_SECTION_LABELS[section];

  const artworkSrcUrl = artworkSrc || TRANSPARENT_FALLBACK_ART;

  return (
    <div className="settings-shell fixed inset-0 flex overflow-hidden select-none">
      <div className="settings-ambient-bg absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <img src={artworkSrcUrl} alt="" decoding="async" key={artworkSrcUrl} />
        <div className="settings-ambient-dimmer absolute inset-0"></div>
      </div>
      {isWindows && <SettingsWinControls />}
      <SettingsNav section={section} onSectionChange={setSection} />

      <main className="settings-pane flex min-w-0 flex-1 flex-col z-[1]">
        <header className="pane-header shrink-0 px-10 pb-2.5 pt-[34px]" data-tauri-drag-region="deep">
          <h1 className="m-0">{activeLabel}</h1>
        </header>
        <div className="pane-body flex flex-1 flex-col gap-6 overflow-y-auto px-10 pb-10 pt-2">
          <AnimatePresence mode="wait" initial={false}>
            {state ? (
              <motion.div
                key={section}
                className="settings-section flex flex-col gap-6"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: SECTION_EASE }}
              >
                <Body
                  section={section}
                  state={state}
                  actions={actions}
                  activeLabel={activeLabel}
                  autostartEnabled={autostartEnabled}
                  monitors={monitors}
                />
              </motion.div>
            ) : (
              <SettingsSkeleton key="settings-skeleton" />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
