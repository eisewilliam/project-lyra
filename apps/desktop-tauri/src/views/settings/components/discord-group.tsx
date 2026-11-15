import { Group, Row, Toggle } from '@/components/settings-controls';
import { useDiscordPresenceStatus } from '../hooks/use-discord-presence-status';

type DiscordGroupProps = Readonly<{
  enabled: boolean;
  includeSpotify: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onIncludeSpotifyChange: (include: boolean) => void;
}>;

/** Showing the current song on the user's Discord profile. Hidden in builds
    that cannot publish to Discord. */
export function DiscordGroup({ enabled, includeSpotify, onEnabledChange, onIncludeSpotifyChange }: DiscordGroupProps) {
  const status = useDiscordPresenceStatus();
  if (!status?.available) return null;

  const hint =
    enabled && !status.connected
      ? 'Waiting for Discord. Open the Discord app on this computer.'
      : 'Shows the song you are listening to on your Discord profile.';

  return (
    <Group title="Discord">
      <Row label="Show what I'm listening to" hint={hint}>
        <Toggle value={enabled} onChange={onEnabledChange} />
      </Row>
      {enabled && (
        <Row label="Include Spotify" hint="Discord already shows Spotify when the two accounts are linked.">
          <Toggle value={includeSpotify} onChange={onIncludeSpotifyChange} />
        </Row>
      )}
    </Group>
  );
}
