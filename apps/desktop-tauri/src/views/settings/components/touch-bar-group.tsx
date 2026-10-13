import { useEffect, useState } from 'react';
import { Group, Row, Toggle } from '@/components/settings-controls';
import type { TouchBarSupport } from '@/types/tauri-contracts';
import { getTouchBarSupport } from '@/utils/tauri-commands';

/** Touch Bar options, shown only on Macs that have one. Lyra's own bar needs
    no setting: it appears whenever Lyra is the active app. */
export function TouchBarGroup({
  controlStrip,
  onControlStripChange,
}: Readonly<{ controlStrip: boolean; onControlStripChange: (enabled: boolean) => Promise<void> }>) {
  const [support, setSupport] = useState<TouchBarSupport | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTouchBarSupport()
      .then((next) => {
        if (!cancelled) setSupport(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!support?.present) return null;

  return (
    <Group title="Touch Bar">
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
  );
}
