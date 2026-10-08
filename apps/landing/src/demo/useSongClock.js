import { useEffect, useRef, useState } from 'react';
import { DURATION, demoSong, lineIndexAt } from './song.js';

// Song position for the illustrative surfaces. React only re-renders when the
// line changes; words and progress bars animate in CSS from the offsets here.
export function useSongClock(playing, startAt = 8.3) {
  const elapsedRef = useRef(startAt);
  const [position, setPosition] = useState(() => describe(startAt));

  useEffect(() => {
    if (!playing) return undefined;
    const startedAt = performance.now();
    const base = elapsedRef.current;
    const now = () => base + (performance.now() - startedAt) / 1000;
    let timer = 0;
    const step = () => {
      const time = now();
      setPosition(current => {
        const next = describe(time);
        return next.index === current.index && next.loop === current.loop ? current : next;
      });
      const songTime = time % DURATION;
      const line = demoSong.lines[lineIndexAt(songTime)];
      timer = window.setTimeout(step, Math.max(16, (line.end - songTime) * 1000 + 4));
    };
    step();
    return () => {
      window.clearTimeout(timer);
      elapsedRef.current = now();
    };
  }, [playing]);

  return position;
}

function describe(time) {
  const songTime = time % DURATION;
  const index = lineIndexAt(songTime);
  return { index, loop: Math.floor(time / DURATION), lineOffset: songTime - demoSong.lines[index].time, songTime };
}
