import { useEffect, useRef, useState } from 'react';
import { lineIndexAt } from './song.js';

// Song position for the illustrative surfaces. React only re-renders when the
// line changes; words and progress bars animate in CSS from the offsets here.
// Changing song restarts the clock a little way into the new song.
export function useSongClock(song, playing, startLine = 1) {
  const startAt = () => song.lines[Math.min(startLine, song.lines.length - 1)].time + 1.1;
  const elapsedRef = useRef(null);
  const songRef = useRef(song);
  if (songRef.current !== song || elapsedRef.current === null) {
    songRef.current = song;
    elapsedRef.current = startAt();
  }
  const [position, setPosition] = useState(() => describe(song, elapsedRef.current));

  useEffect(() => {
    setPosition(describe(song, elapsedRef.current));
    if (!playing) return undefined;
    const startedAt = performance.now();
    const base = elapsedRef.current;
    const now = () => base + (performance.now() - startedAt) / 1000;
    let timer = 0;
    const step = () => {
      const time = now();
      setPosition(current => {
        const next = describe(song, time);
        return next.index === current.index && next.loop === current.loop && next.song === current.song ? current : next;
      });
      const songTime = time % song.duration;
      const line = song.lines[lineIndexAt(song, songTime)];
      timer = window.setTimeout(step, Math.max(16, (line.end - songTime) * 1000 + 4));
    };
    step();
    return () => {
      window.clearTimeout(timer);
      if (songRef.current === song) elapsedRef.current = now();
    };
  }, [playing, song]);

  return position;
}

function describe(song, time) {
  const songTime = time % song.duration;
  const index = lineIndexAt(song, songTime);
  return { song: song.id, index, loop: Math.floor(time / song.duration), lineOffset: songTime - song.lines[index].time, songTime };
}
