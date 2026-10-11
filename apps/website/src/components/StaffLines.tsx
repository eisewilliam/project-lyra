// Static echo of the hero: five curved staff lines of light, with lyrics
// written along two of them in the same italic as the hero field.
const LINES = [0, 1, 2, 3, 4];
const path = (line: number) => `M-20 ${44 + line * 14} C 240 ${20 + line * 14}, 520 ${78 + line * 14}, 800 ${46 + line * 14} S 1100 ${26 + line * 14}, 1220 ${52 + line * 14}`;

// A lyric written along staff line `line`, starting `offset` along it (e.g. '18%').
export type StaffLyric = [line: number, text: string, offset: string];

export function StaffLines({ id, lyrics = [], className = '' }: { id: string; lyrics?: StaffLyric[]; className?: string }) {
  return <svg className={'staff-lines ' + className} viewBox="0 0 1200 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>{LINES.map(line => <path key={line} id={`${id}-${line}`} d={path(line)} />)}</defs>
    {LINES.map(line => <use key={line} href={`#${id}-${line}`} className="staff-line" />)}
    {lyrics.map(([line, text, offset]) => <text key={line} className="staff-lyric" dy="-4">
      <textPath href={`#${id}-${line}`} startOffset={offset}>{text}</textPath>
    </text>)}
  </svg>;
}
