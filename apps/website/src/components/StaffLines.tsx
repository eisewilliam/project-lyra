import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

// Quiet echo of the hero: five curved staff lines of light, with lyrics
// written along two of them in the same italic as the hero field. In view, the
// lines draw in from the left, then breathe on a slow wave while a glint runs
// along them now and then. Still for visitors who prefer reduced motion.
const LINES = [0, 1, 2, 3, 4];
// Seconds for one full breath of the wave, and between glints.
const BREATH = 16;
const GLINT = 9;

// One staff line. `phase` (0 to 1) moves a wave along it, starting and ending
// at the resting shape so the loop has no seam.
function path(line: number, phase = 0) {
  const lift = (index: number) => Math.round((Math.sin(phase * Math.PI * 2 + index * 0.9) - Math.sin(index * 0.9)) * 7 * 10) / 10;
  const y = (base: number, index: number) => base + line * 14 + lift(index);
  return `M-20 ${y(44, 0)} C 240 ${y(20, 1)}, 520 ${y(78, 2)}, 800 ${y(46, 3)} S 1100 ${y(26, 4)}, 1220 ${y(52, 5)}`;
}

const breath = (line: number) => [0, 0.25, 0.5, 0.75, 1].map(phase => path(line, phase)).join(';');
const EASE = '0.45 0 0.55 1';

// A lyric written along staff line `line`, starting `offset` along it (e.g. '18%').
export type StaffLyric = [line: number, text: string, offset: string];

export function StaffLines({ id, lyrics = [], className = '' }: { id: string; lyrics?: StaffLyric[]; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const still = useReducedMotion() ?? false;
  const [shown, setShown] = useState(false);

  // Start when the staff comes into view, and pause its animations off screen.
  // Watch the container: the staff's own clip hides it until it is shown.
  useEffect(() => {
    const svg = ref.current;
    const container = svg?.parentElement;
    if (!svg || !container) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      if (entry.isIntersecting) {
        setShown(true);
        svg.unpauseAnimations();
      } else svg.pauseAnimations();
    }, { threshold: 0.2 });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const moving = shown && !still;
  return <svg ref={ref} className={'staff-lines ' + className} data-state={shown || still ? 'shown' : 'hidden'}
    viewBox="0 0 1200 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      {LINES.map(line => <path key={line} id={`${id}-${line}`} d={path(line)}>
        {moving && <animate attributeName="d" values={breath(line)} dur={`${BREATH}s`} repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.25;0.5;0.75;1" keySplines={Array(4).fill(EASE).join(';')} />}
      </path>)}
      <linearGradient id={`${id}-glint`} gradientUnits="userSpaceOnUse" x1="-260" y1="0" x2="0" y2="0">
        <stop offset="0" stopColor="#cdeee6" stopOpacity="0" />
        <stop offset="0.5" stopColor="#cdeee6" stopOpacity="0.9" />
        <stop offset="1" stopColor="#cdeee6" stopOpacity="0" />
        {moving && <animateTransform attributeName="gradientTransform" type="translate" values="-200 0;1700 0;1700 0"
          keyTimes="0;0.45;1" dur={`${GLINT}s`} begin="1.4s" repeatCount="indefinite" calcMode="spline"
          keySplines={`${EASE};0 0 1 1`} />}
      </linearGradient>
    </defs>
    {LINES.map(line => <use key={line} href={`#${id}-${line}`} className="staff-line" />)}
    {moving && LINES.map(line => <use key={line} href={`#${id}-${line}`} className="staff-glint" stroke={`url(#${id}-glint)`} />)}
    {lyrics.map(([line, text, offset]) => <text key={line} className="staff-lyric" dy="-4">
      <textPath href={`#${id}-${line}`} startOffset={offset}>{text}</textPath>
    </text>)}
  </svg>;
}
