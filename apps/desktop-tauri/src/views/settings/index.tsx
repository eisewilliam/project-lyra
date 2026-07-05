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

export default function Settings() {
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
    <div className="settings-shell">
      <div className="settings-ambient-bg" aria-hidden="true">
        <img src={artworkSrcUrl} alt="" decoding="async" key={artworkSrcUrl} />
        <div className="settings-ambient-dimmer"></div>
      </div>
      {isWindows && <SettingsWinControls />}
      <SettingsNav section={section} onSectionChange={setSection} />

      <main className="settings-pane">
        <header className="pane-header" data-tauri-drag-region="deep">
          <h1>{activeLabel}</h1>
        </header>
        <div className="pane-body">
          {state ? (
            <Body
              section={section}
              state={state}
              actions={actions}
              activeLabel={activeLabel}
              autostartEnabled={autostartEnabled}
              monitors={monitors}
            />
          ) : (
            <SettingsSkeleton />
          )}
        </div>
      </main>
    </div>
  );
}
