import { ActionFeedbackButton } from '@/components/settings-controls';
import { SourceIcon } from '@/components/source-icon';
import type {
  PlaybackCaps,
  PlayerSessionInfo,
  PositionQuality,
  Transport,
} from '@/types/tauri-contracts';
import {
  IGNORE_REASON_LABELS,
  IGNORE_REASON_SHORT,
  mediaSourceLabel,
} from '@/utils/media-labels';
import { sourceBrand } from '@/utils/source-brand';

const TRANSPORT_LABELS: Record<Transport, string> = {
  AppleScript: 'AppleScript',
  MediaRemote: 'macOS Now Playing',
  Smtc: 'Windows media controls',
  Mpris: 'MPRIS',
};

const TIMING_LABELS: Record<PositionQuality, string> = {
  Exact: 'Synced to the player',
  Extrapolated: 'Synced to the player',
  Missing: 'Not reported, lyrics cannot sync',
};

function controlsLabel(caps: PlaybackCaps): string {
  const supported = [
    caps.play_pause && 'play and pause',
    (caps.next || caps.previous) && 'skip',
    caps.seek && 'seek',
  ].filter((c): c is string => Boolean(c));
  const last = supported.pop();
  if (!last) return 'None';
  const text = supported.length > 0 ? `${supported.join(', ')} and ${last}` : last;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detectedAsLabel(session: PlayerSessionInfo): string {
  if (session.ignored) return IGNORE_REASON_LABELS[session.ignored];
  switch (session.kind) {
    case 'Music':
      return 'Music';
    case 'NotMusic':
      return 'Not music';
    case 'Unsure':
      return 'Not sure it is music';
    default:
      return 'Unknown';
  }
}

type Status = { text: string; tone: 'live' | 'following' | 'idle' | 'ignored' };

function status(session: PlayerSessionInfo): Status {
  if (session.active) {
    // The followed player keeps its accent while paused, so it stays
    // distinguishable from other paused players.
    return { text: 'Following', tone: session.state === 'Playing' ? 'live' : 'following' };
  }
  if (session.ignored) return { text: IGNORE_REASON_SHORT[session.ignored], tone: 'ignored' };
  return { text: session.state, tone: 'idle' };
}

type TrackAction = { label: string; value: boolean | null };

/** The per-track override offered for this session, if any. */
function trackAction(session: PlayerSessionInfo): TrackAction | null {
  if (!session.track_key) return null;
  if (session.marked_music !== null) {
    return { label: session.marked_music ? 'Undo "music"' : 'Undo "not music"', value: null };
  }
  if (session.ignored && session.ignored !== 'AppRule' && session.ignored !== 'OtherPlayerSelected') {
    return { label: 'This is music', value: true };
  }
  if (session.active) return { label: 'Not music', value: false };
  return null;
}

/**
 * One active playback session: what is playing and where at a glance, with
 * details and per-track overrides behind a disclosure. Per-app rules live in
 * the detected players list.
 */
export function PlayerSessionRow({
  session,
  pinned,
  onPin,
  onTrackOverride,
}: Readonly<{
  session: PlayerSessionInfo;
  /** This session's app is the one Lyra is set to follow exclusively. */
  pinned: boolean;
  onPin: (appId: string | null) => Promise<void>;
  onTrackOverride: (trackKey: string, isMusic: boolean | null) => Promise<void>;
}>) {
  const player = session.player;
  const source = mediaSourceLabel(player, session.platform);
  const state = status(session);
  const action = trackAction(session);
  const trackKey = session.track_key;

  return (
    <details className="player-session">
      <summary className="player-session-summary">
        <span className="player-session-icon">
          <SourceIcon brand={sourceBrand(session.platform, player)} size={20} />
        </span>
        <span className="player-session-track">
          <span className="player-session-title">{session.title ?? source}</span>
          {session.artist ? <span className="player-session-artist">{session.artist}</span> : null}
        </span>
        <span className="player-session-where">
          <span className="player-session-status" data-tone={state.tone}>{state.text}</span>
          <span className="player-session-source">{source}</span>
        </span>
        <svg className="player-session-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <div className="player-session-body">
        <dl className="player-session-facts">
          <dt>Detected as</dt>
          <dd>{detectedAsLabel(session)}</dd>
          <dt>Read through</dt>
          <dd>{TRANSPORT_LABELS[session.transport]}</dd>
          <dt>Timing</dt>
          <dd>{TIMING_LABELS[session.position_quality]}</dd>
          <dt>Controls</dt>
          <dd>{controlsLabel(session.caps)}</dd>
        </dl>

        <div className="player-session-actions">
          {player ? (
            <ActionFeedbackButton
              label={pinned ? 'Follow any player' : 'Follow only this player'}
              pendingLabel="Saving..."
              feedbackLabel="Saved"
              failureLabel="Failed"
              onClick={() => onPin(pinned ? null : player.id)}
            />
          ) : null}
          {action && trackKey ? (
            <ActionFeedbackButton
              label={action.label}
              pendingLabel="Saving..."
              feedbackLabel="Saved"
              failureLabel="Failed"
              onClick={() => onTrackOverride(trackKey, action.value)}
            />
          ) : null}
        </div>
      </div>
    </details>
  );
}
