import { Group, Row } from '@/components/settings-controls';
import type { UpdateStatus } from '@/types/tauri-contracts';
import { timeAgo } from '@/utils/relative-time';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { checkForUpdates, installUpdate } from '@/utils/tauri-commands';
import { useUpdateStatus } from '../hooks/use-update-status';

type Updatable = Exclude<UpdateStatus, { state: 'unavailable' }>;

/** What the updater is doing, as the row's headline. */
function headline(status: Updatable): string {
  switch (status.state) {
    case 'idle':
      return 'Lyra updates automatically';
    case 'checking':
      return 'Checking for updates…';
    case 'up_to_date':
      return 'Lyra is up to date';
    case 'downloading':
      return `Downloading Lyra ${status.version}…`;
    case 'ready':
      return `Lyra ${status.version} is ready`;
    case 'failed':
      return "Couldn't check for updates";
  }
}

/** The installed version, plus the one fact that goes with the headline. */
function detail(status: Updatable, version: string): string {
  switch (status.state) {
    case 'up_to_date':
      return `Version ${version} · Checked ${timeAgo(status.checked_at_ms)}`;
    case 'downloading':
    case 'ready':
      return `Version ${version} installed`;
    case 'failed':
      return `Version ${version} · Lyra will try again later`;
    default:
      return `Version ${version}`;
  }
}

/** Update state first, the installed version beneath it, and the one action
    that fits. A build that can't update itself just states its version. */
export function UpdatesGroup() {
  const info = useUpdateStatus();
  if (!info) return null;
  const { status, current_version: version } = info;

  if (status.state === 'unavailable') {
    return (
      <Group title="About">
        <Row label="Version">
          <span className="row-value">{version}</span>
        </Row>
      </Group>
    );
  }

  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <Group title="Updates">
      <Row label={headline(status)} hint={detail(status, version)}>
        {status.state === 'ready' ? (
          <button type="button" className="action-btn is-primary" onClick={() => runSettingsAction(installUpdate())}>
            Restart to install
          </button>
        ) : (
          <button
            type="button"
            className="action-btn"
            disabled={busy}
            onClick={() => runSettingsAction(checkForUpdates())}
          >
            Check now
          </button>
        )}
      </Row>
    </Group>
  );
}
