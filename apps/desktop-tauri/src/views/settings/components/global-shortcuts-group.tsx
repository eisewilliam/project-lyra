import { useEffect, useState } from 'react';
import { Group, Row, Toggle } from '@/components/settings-controls';
import type { GlobalShortcutStatus } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import { getGlobalShortcutsStatus, setGlobalShortcutsEnabled } from '@/utils/tauri-commands';

export function GlobalShortcutsGroup() {
  const [status, setStatus] = useState<GlobalShortcutStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMac = detectHostOs() === 'macos';

  useEffect(() => {
    let active = true;
    getGlobalShortcutsStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setError("Couldn't load shortcuts."); });
    return () => { active = false; };
  }, []);

  const setEnabled = async (enabled: boolean) => {
    setPending(true);
    setError(null);
    try {
      setStatus(await setGlobalShortcutsEnabled(enabled));
    } catch (reason) {
      setError(typeof reason === 'string' ? reason : "Couldn't change global shortcuts.");
      getGlobalShortcutsStatus().then(setStatus).catch(() => undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Group title="Shortcuts">
      <Row
        label="Global shortcuts"
        hint={status?.available === false ? 'Unavailable on this desktop.' : undefined}
        disabled={!status?.available || pending}
      >
        <Toggle value={status?.enabled ?? false} onChange={setEnabled} />
      </Row>
      {error && <p className="shortcut-settings-error" role="alert">{error}</p>}
      {status?.enabled && status.available && status.bindings.map((binding) => (
        <Row
          key={binding.key}
          label={binding.label}
          hint={binding.registered ? undefined : 'Another app may be using this shortcut.'}
        >
          <kbd className="global-shortcut-key">{isMac ? `⌘⌥⇧${binding.key}` : `Ctrl + Alt + Shift + ${binding.key}`}</kbd>
        </Row>
      ))}
    </Group>
  );
}
