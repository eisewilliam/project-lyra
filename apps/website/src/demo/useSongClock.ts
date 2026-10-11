import { useEffect, useRef, useState } from 'react';
import { lineAt, lineIndexAt, type Song, type SongId } from './song.ts';

export interface SongPosition {
  song: SongId;
  index: number;
  loop: number;
  lineOffset: number;
  songTime: number;
}

// Song position for the illustrative surfaces. React only re-renders when the
// line changes; words and progress bars animate in CSS from the offsets here.
// Changing song restarts the clock a little way into the new song.
export function useSongClock(song: Song, playing: boolean, startLine = 1): SongPosition {
  // Elapsed time survives pausing; each song keeps its own clock.
  const clockRef = useRef<{ song: Song; elapsed: number } | null>(null);
  const [position, setPosition] = useState(() => describe(song, startTime(song, startLine)));

  useEffect(() => {
    if (clockRef.current?.song !== song) clockRef.current = { song, elapsed: startTime(song, startLine) };
    const clock = clockRef.current;
    setPosition(describe(song, clock.elapsed));
    if (!playing) return undefined;
    const startedAt = performance.now();
    const base = clock.elapsed;
    const now = () => base + (performance.now() - startedAt) / 1000;
    let timer = 0;
    const step = () => {
      const time = now();
      setPosition(current => {
        const next = describe(song, time);
        return next.index === current.index && next.loop === current.loop && next.song === current.song ? current : next;
      });
      const songTime = time % song.duration;
      const line = lineAt(song, lineIndexAt(song, songTime));
      timer = window.setTimeout(step, Math.max(16, (line.end - songTime) * 1000 + 4));
    };
    step();
    return () => {
      window.clearTimeout(timer);
      clock.elapsed = now();
    };
  }, [playing, song, startLine]);

  // Until the effect catches up, a new song starts from its own beginning
  // rather than the previous song's position.
  return position.song === song.id ? position : describe(song, startTime(song, startLine));
}

function startTime(song: Song, startLine: number) {
  return lineAt(song, Math.min(startLine, song.lines.length - 1)).time + 1.1;
}

function describe(song: Song, time: number): SongPosition {
  const songTime = time % song.duration;
  const index = lineIndexAt(song, songTime);
  return { song: song.id, index, loop: Math.floor(time / song.duration), lineOffset: songTime - lineAt(song, index).time, songTime };
}
