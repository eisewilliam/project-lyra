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
      ? 'Open Discord to connect.'
      : 'Apple may receive the title and artist for cover art.';

  return (
    <Group title="Discord">
      <Row label="Show what I'm listening to" hint={hint}>
        <Toggle value={enabled} onChange={onEnabledChange} />
      </Row>
      {enabled && (
        <Row label="Include Spotify">
          <Toggle value={includeSpotify} onChange={onIncludeSpotifyChange} />
        </Row>
      )}
    </Group>
  );
}
