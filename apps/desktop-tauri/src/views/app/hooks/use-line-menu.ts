import { useCallback, useRef, useEffect } from 'react';
import { showMenu, type MenuEntry } from '@/utils/native-menu';
import { copyText } from '@/utils/tauri-commands';
import type { LineRef } from '../types';
import { noop } from '../utils';

/**
 * Native context menu for the lyrics pane, at the pointer: copy the line
 * under it or every line, and play from a line. Built per open so it always
 * reflects the current track.
 */
export function useLineMenu({
  lyrics,
  plainLyrics,
  canSeek,
  seekToLine,
}: {
  lyrics: ReadonlyArray<LineRef>;
  plainLyrics: string | null;
  canSeek: boolean;
  seekToLine: (index: number, ts: number) => void;
}) {
  const latestRef = useRef({ lyrics, plainLyrics, canSeek, seekToLine });
  useEffect(() => {
    latestRef.current = { lyrics, plainLyrics, canSeek, seekToLine };
  }, [lyrics, plainLyrics, canSeek, seekToLine]);

  return useCallback((index: number | null) => {
    const { lyrics: lines, plainLyrics: plain, canSeek: seekable, seekToLine: seek } = latestRef.current;
    const line = index !== null ? lines[index] : undefined;
    const allText = lines.length > 0
      ? lines.map((l) => l.text).join('\n').trim()
      : (plain ?? '').trim();
    if (!line && !allText) return;

    const copy: MenuEntry[] = [];
    if (line?.text.trim()) {
      copy.push({ id: 'copy-line', label: 'Copy Line', symbol: 'doc.on.doc', onSelect: () => { copyText(line.text).catch(noop); } });
    }
    if (allText) {
      copy.push({ id: 'copy-all', label: 'Copy All Lyrics', symbol: 'doc.on.clipboard', onSelect: () => { copyText(allText).catch(noop); } });
    }
    const play: MenuEntry[] = line && index !== null
      ? [{ id: 'play-from-line', label: 'Play From Here', symbol: 'play', disabled: !seekable, onSelect: () => seek(index, performance.now()) }]
      : [];
    showMenu([copy, play].filter((group) => group.length > 0)).catch(noop);
  }, []);
}
