import { ActionFeedbackButton, CustomSelect } from '@/components/settings-controls';
import { SourceIcon } from '@/components/source-icon';
import type { FollowRule, KnownPlayerInfo } from '@/types/tauri-contracts';
import { timeAgo } from '@/utils/relative-time';
import { sourceBrand } from '@/utils/source-brand';
import { FOLLOW_RULE_OPTIONS } from '../settings-options';

function isFollowRule(value: string): value is FollowRule {
  return value === 'Auto' || value === 'Always' || value === 'Never';
}

function usage(player: KnownPlayerInfo): string {
  if (player.pinned) return 'The only player Lyra follows';
  if (player.running) return 'Running now';
  return `Last used ${timeAgo(player.last_seen_ms)}`;
}

/**
 * A player Lyra has seen before: its following rule can change whether or
 * not it is running.
 */
export function KnownPlayerRow({
  player,
  onRuleChange,
  onForget,
}: Readonly<{
  player: KnownPlayerInfo;
  onRuleChange: (appId: string, rule: FollowRule) => Promise<void>;
  onForget: (appId: string) => Promise<void>;
}>) {
  const { app } = player;
  return (
    <div className="known-player">
      <span className="player-session-icon">
        <SourceIcon brand={sourceBrand(null, app)} size={20} />
      </span>
      <span className="player-session-track">
        <span className="player-session-title">{app.name}</span>
        <span className="player-session-artist">{usage(player)}</span>
      </span>
      <span className="known-player-controls">
        <CustomSelect
          value={player.rule}
          options={FOLLOW_RULE_OPTIONS}
          label={`When ${app.name} plays`}
          onChange={(value) => (isFollowRule(value) ? onRuleChange(app.id, value) : undefined)}
        />
        <ActionFeedbackButton
          quiet
          label="Forget"
          pendingLabel="Forgetting…"
          feedbackLabel="Forgotten"
          failureLabel="Couldn't forget"
          onClick={() => onForget(app.id)}
        />
      </span>
    </div>
  );
}
