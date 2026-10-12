import { Group, Row } from '@/components/settings-controls';
import type { UpdateStatus } from '@/types/tauri-contracts';
import { timeAgo } from '@/utils/relative-time';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { checkForUpdates, installUpdate } from '@/utils/tauri-commands';
import { useUpdateStatus } from '../hooks/use-update-status';

function describe(status: UpdateStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Lyra checks for updates automatically.';
    case 'checking':
      return 'Checking for updates…';
    case 'up_to_date':
      return `Lyra is up to date. Checked ${timeAgo(status.checked_at_ms)}.`;
    case 'downloading':
      return `Downloading Lyra ${status.version}…`;
    case 'ready':
      return `Lyra ${status.version} is ready. Restart to install it.`;
    case 'failed':
      return "Couldn't check for updates. Lyra will try again later.";
    case 'unavailable':
      return "This build doesn't update itself.";
  }
}

/** Current version, update state, and the one action that fits it. */
export function UpdatesGroup() {
  const info = useUpdateStatus();
  if (!info) return null;
  const { status } = info;
  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <Group title="Updates">
      <Row label={`Lyra ${info.current_version}`} hint={describe(status)}>
        {status.state === 'ready' ? (
          <button type="button" className="action-btn" onClick={() => runSettingsAction(installUpdate())}>
            Restart to install
          </button>
        ) : (
          <button
            type="button"
            className="action-btn"
            disabled={busy || status.state === 'unavailable'}
            onClick={() => runSettingsAction(checkForUpdates())}
          >
            Check now
          </button>
        )}
      </Row>
    </Group>
  );
}
