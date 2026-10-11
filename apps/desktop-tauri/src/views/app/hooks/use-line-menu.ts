import { useCallback, useRef, useEffect } from 'react';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { copyText } from '@/utils/tauri-commands';
import type { LineRef } from '../types';
import { noop } from '../utils';

/**
 * Native context menu for the lyrics pane: copy the line under the pointer
 * or every line, and play from a line. Built per open so it always reflects
 * the current track.
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

    void (async () => {
      const items = [];
      if (line?.text.trim()) {
        items.push({ id: 'copy-line', text: 'Copy Line', action: () => { copyText(line.text).catch(noop); } });
      }
      if (allText) {
        items.push({ id: 'copy-all', text: 'Copy All Lyrics', action: () => { copyText(allText).catch(noop); } });
      }
      if (line && index !== null) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        items.push({
          id: 'play-from-line',
          text: 'Play From Here',
          enabled: seekable,
          action: () => seek(index, performance.now()),
        });
      }
      const menu = await Menu.new({ items });
      await menu.popup();
    })().catch(noop);
  }, []);
}
