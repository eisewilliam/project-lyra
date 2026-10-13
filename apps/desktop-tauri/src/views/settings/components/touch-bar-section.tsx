import { Group, Row, Toggle } from '@/components/settings-controls';
import type { TouchBarSupport } from '@/types/tauri-contracts';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { customizeTouchBar } from '@/utils/tauri-commands';

/** Touch Bar page, listed only on Macs that have one. Lyra's own bar needs
    no switch: it appears whenever Lyra is the active app. */
export function TouchBarSection({
  support,
  controlStrip,
  onControlStripChange,
}: Readonly<{
  support: TouchBarSupport;
  controlStrip: boolean;
  onControlStripChange: (enabled: boolean) => Promise<void>;
}>) {
  return (
    <>
      <Group title="In Lyra">
        <Row label="Touch Bar buttons" hint="Lyra's bar shows while Lyra is the active app.">
          <button type="button" className="action-btn" onClick={() => runSettingsAction(customizeTouchBar())}>
            Customize…
          </button>
        </Row>
      </Group>

      <Group title="In other apps">
        <Row
          label="Show Lyra in the Control Strip"
          hint={
            support.control_strip
              ? 'Tap it to show lyrics over any app. It replaces the Now Playing button.'
              : 'Not available on this version of macOS.'
          }
          disabled={!support.control_strip}
        >
          <Toggle value={controlStrip && support.control_strip} onChange={onControlStripChange} />
        </Row>
      </Group>
    </>
  );
}
