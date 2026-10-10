import { ActionFeedbackButton, CustomSelect, Group, Row, Toggle } from '@/components/settings-controls';
import type {
  BrowserLyrics,
  FollowRule,
  KnownPlayerInfo,
  MediaPolicyView,
  PlayerApp,
} from '@/types/tauri-contracts';
import {
  forgetPlayer,
  setAppRule,
  setOnlyMusic,
  setPinnedApp,
  setTrackOverride,
} from '@/utils/tauri-commands';
import { useKnownPlayers } from '../hooks/use-known-players';
import { useMediaPolicy } from '../hooks/use-media-policy';
import { usePlayerSessions } from '../hooks/use-player-sessions';
import { BROWSER_LYRICS_OPTIONS } from '../settings-options';
import { KnownPlayerRow } from './known-player-row';
import { PlayerSessionRow } from './player-session-row';

const AUTOMATIC = '';

function isBrowserLyrics(value: string): value is BrowserLyrics {
  return value === 'Ask' || value === 'Allow' || value === 'Deny';
}

/** Players the user can pin: every known app plus the pinned one. */
function followOptions(known: KnownPlayerInfo[] | null, pinned: PlayerApp | null) {
  const apps = new Map<string, string>();
  for (const player of known ?? []) apps.set(player.app.id, player.app.name);
  if (pinned && !apps.has(pinned.id)) apps.set(pinned.id, pinned.name);
  return [
    { value: AUTOMATIC, label: 'Whichever is playing' },
    ...[...apps].map(([id, name]) => ({ value: id, label: `Only ${name}` })),
  ];
}

export function PlayersSection({
  browserLyrics,
  onBrowserLyricsChange,
}: Readonly<{
  browserLyrics: BrowserLyrics;
  onBrowserLyricsChange: (choice: BrowserLyrics) => Promise<void>;
}>) {
  const { sessions, refresh: refreshSessions } = usePlayerSessions();
  const { players: known, refresh: refreshKnown } = useKnownPlayers();
  const { policy, applyPolicy } = useMediaPolicy();
  const pinned = policy?.pinned_app ?? null;

  const refresh = async () => {
    await Promise.all([refreshSessions(), refreshKnown()]);
  };
  /** Policy commands resolve after players are re-polled; refresh then. */
  const applyAndRefresh = async (change: Promise<MediaPolicyView>) => {
    applyPolicy(await change);
    await refresh();
  };
  const pin = (appId: string | null) => applyAndRefresh(setPinnedApp(appId));

  return (
    <>
      <Group title="Following">
        <Row label="Player">
          <CustomSelect
            value={pinned?.id ?? AUTOMATIC}
            options={followOptions(known, pinned)}
            onChange={(value) => pin(value === AUTOMATIC ? null : value)}
          />
        </Row>
        <Row label="Only follow music">
          <Toggle
            value={policy?.only_music ?? true}
            onChange={(on: boolean) => applyAndRefresh(setOnlyMusic(on))}
          />
        </Row>
        <Row label="Lyrics for media playing in a browser">
          <CustomSelect
            value={browserLyrics}
            options={BROWSER_LYRICS_OPTIONS}
            onChange={(value) => (isBrowserLyrics(value) ? onBrowserLyricsChange(value) : undefined)}
          />
        </Row>
      </Group>

      <Group title="Active players">
        {sessions === null && <Row label="Looking for players…">{null}</Row>}
        {sessions?.length === 0 && <Row label="Nothing is playing right now">{null}</Row>}
        {sessions?.map((session) => (
          <PlayerSessionRow
            key={session.id}
            session={session}
            pinned={Boolean(pinned && session.player?.id === pinned.id)}
            onPin={pin}
            onTrackOverride={(trackKey, isMusic) => applyAndRefresh(setTrackOverride(trackKey, isMusic))}
          />
        ))}
      </Group>

      <Group title="Detected players">
        {known === null && <Row label="Loading…">{null}</Row>}
        {known?.length === 0 && <Row label="Players appear here once they play something">{null}</Row>}
        {known?.map((player) => (
          <KnownPlayerRow
            key={player.app.id}
            player={player}
            onRuleChange={(appId: string, rule: FollowRule) => applyAndRefresh(setAppRule(appId, rule))}
            onForget={(appId: string) => applyAndRefresh(forgetPlayer(appId))}
          />
        ))}
      </Group>

      <Group title="Diagnostics">
        <Row label="Player lists">
          <ActionFeedbackButton
            label="Refresh"
            pendingLabel="Refreshing..."
            feedbackLabel="Updated"
            failureLabel="Failed"
            onClick={refresh}
          />
        </Row>
      </Group>
    </>
  );
}
