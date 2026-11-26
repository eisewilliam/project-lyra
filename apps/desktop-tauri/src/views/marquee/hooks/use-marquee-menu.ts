import { useCallback, useEffect, useRef } from 'react';
import { showMenu, type MenuEntry, type MenuGroups } from '@/utils/native-menu';
import { detectHostOs } from '@/utils/os';
import {
  copyText,
  nudgeLyricOffset,
  openChooseLyrics,
  setLyricOffset,
  setMarqueeLocked,
  setTrackOverride,
} from '@/utils/tauri-commands';
import { describeOffset, formatOffsetShort } from '@/views/app/sync-timing';

const MARQUEE_SYNC_STEP_MS = 200;
const isMac = detectHostOs() === 'macos';
const noop = () => {};

/**
 * Right-click system menu for the Marquee. Built per open so timing offsets,
 * lock state, and the visible/peeked lyric line always stay in sync.
 */
export function useMarqueeMenu({
  hasTrack,
  trackKey,
  hasSyncedLyrics,
  lyricOffsetMs,
  currentLineText,
  locked,
  onOpenMain,
  onCancelPeek,
  onFeedback,
  onMenuOpenChange,
}: {
  hasTrack: boolean;
  trackKey: string;
  hasSyncedLyrics: boolean;
  lyricOffsetMs: number;
  currentLineText: string | null;
  locked: boolean;
  onOpenMain: () => void;
  onCancelPeek: () => void;
  onFeedback: (label: string) => void;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const latestRef = useRef({
    hasTrack,
    trackKey,
    hasSyncedLyrics,
    lyricOffsetMs,
    currentLineText,
    locked,
    onOpenMain,
    onCancelPeek,
    onFeedback,
    onMenuOpenChange,
  });
  const openRef = useRef(false);

  useEffect(() => {
    latestRef.current = {
      hasTrack,
      trackKey,
      hasSyncedLyrics,
      lyricOffsetMs,
      currentLineText,
      locked,
      onOpenMain,
      onCancelPeek,
      onFeedback,
      onMenuOpenChange,
    };
  }, [
    hasTrack,
    trackKey,
    hasSyncedLyrics,
    lyricOffsetMs,
    currentLineText,
    locked,
    onOpenMain,
    onCancelPeek,
    onFeedback,
    onMenuOpenChange,
  ]);

  return useCallback(() => {
    if (openRef.current) return;
    const {
      hasTrack: trackPresent,
      trackKey: activeTrackKey,
      hasSyncedLyrics: synced,
      lyricOffsetMs: offsetMs,
      currentLineText: lineText,
      locked: isLocked,
      onOpenMain: revealMain,
      onCancelPeek: clearPeek,
      onFeedback: report,
      onMenuOpenChange: notifyOpen,
    } = latestRef.current;

    const groups: MenuEntry[][] = [];
    const trimmedLine = lineText?.trim() ?? '';

    if (trackPresent) {
      const timingGroup: MenuEntry[] = [
        {
          id: 'sync-earlier',
          label: `Sync Earlier (${formatOffsetShort(-MARQUEE_SYNC_STEP_MS)})`,
          symbol: 'gobackward',
          hint: !synced ? 'Needs synced lyrics' : undefined,
          disabled: !synced,
          onSelect: () => {
            clearPeek();
            nudgeLyricOffset(-MARQUEE_SYNC_STEP_MS)
              .then((offset) => report(offset === 0 ? describeOffset(0) : formatOffsetShort(offset)))
              .catch(noop);
          },
        },
        {
          id: 'sync-later',
          label: `Sync Later (${formatOffsetShort(MARQUEE_SYNC_STEP_MS)})`,
          symbol: 'goforward',
          disabled: !synced,
          onSelect: () => {
            clearPeek();
            nudgeLyricOffset(MARQUEE_SYNC_STEP_MS)
              .then((offset) => report(offset === 0 ? describeOffset(0) : formatOffsetShort(offset)))
              .catch(noop);
          },
        },
      ];
      if (synced && offsetMs !== 0) {
        timingGroup.push({
          id: 'reset-timing',
          label: !isMac ? `Reset Sync (${formatOffsetShort(offsetMs)})` : 'Reset Sync',
          symbol: 'arrow.counterclockwise',
          hint: describeOffset(offsetMs),
          onSelect: () => {
            clearPeek();
            setLyricOffset(0)
              .then(() => report(describeOffset(0)))
              .catch(noop);
          },
        });
      }
      groups.push(timingGroup);

      groups.push([
        {
          id: 'choose-lyrics',
          label: 'Choose Lyrics…',
          symbol: 'text.magnifyingglass',
          onSelect: () => {
            clearPeek();
            revealMain();
            openChooseLyrics().catch(noop);
          },
        },
        {
          id: 'copy-line',
          label: 'Copy Current Line',
          symbol: 'doc.on.doc',
          disabled: !trimmedLine,
          onSelect: () => {
            if (!trimmedLine) return;
            copyText(trimmedLine)
              .then(() => report('Copied'))
              .catch(noop);
          },
        },
      ]);
    }

    const panelGroup: MenuEntry[] = [
      {
        id: 'lock-position',
        label: isLocked ? 'Unlock Position' : 'Lock Position',
        symbol: isLocked ? 'lock.open' : 'lock',
        onSelect: () => {
          setMarqueeLocked(!isLocked)
            .then(() => report(isLocked ? 'Unlocked' : 'Locked'))
            .catch(noop);
        },
      },
    ];
    if (trackPresent && activeTrackKey) {
      panelGroup.push({
        id: 'not-music',
        label: 'Not Music',
        symbol: 'music.note.slash',
        hint: 'Stops following this track',
        onSelect: () => {
          clearPeek();
          setTrackOverride(activeTrackKey, false).catch(noop);
        },
      });
    }
    groups.push(panelGroup);

    const menuGroups: MenuGroups = groups;
    openRef.current = true;
    notifyOpen(true);
    void showMenu(menuGroups)
      .catch(noop)
      .finally(() => {
        openRef.current = false;
        latestRef.current.onMenuOpenChange(false);
      });
  }, []);
}
