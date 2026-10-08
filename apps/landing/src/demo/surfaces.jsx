import { Fragment, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react';
import { DURATION, demoSong } from './song.js';

// Illustrative recreations of Lyra's surfaces, modelled on the desktop app's
// own views. Purely visual: the surrounding figure carries the accessible label.

export function SungLine({ line, offset = 0, className = '' }) {
  return <span className={'sung-line ' + className}>
    {line.words.map((word, index) => <Fragment key={index}>
      <span className="sung-word" style={{
        animationDelay: `${(word.start - line.time - offset).toFixed(3)}s`,
        animationDuration: `${word.duration.toFixed(3)}s`,
      }}>{word.text}</span>{index < line.words.length - 1 ? ' ' : null}
    </Fragment>)}
  </span>;
}

// Mounted once per loop so its CSS animation starts from the song position.
function SongProgress({ songTime, className }) {
  const [delay] = useState(() => -songTime);
  return <span className={className} style={{ animationDelay: `${delay}s`, animationDuration: `${DURATION}s` }} />;
}

export function DemoArtwork({ className = '' }) {
  return <span className={'demo-art ' + className}><span /></span>;
}

export function LyraWindow({ position, playing }) {
  const { index, loop, songTime } = position;
  return <div className="surface surface-window">
    <div className="window-sidebar">
      <span className="window-dots"><i /><i /><i /></span>
      <DemoArtwork className="window-art" />
      <span className="window-title">{demoSong.title}</span>
      <span className="window-artist">{demoSong.artist}</span>
      <span className="window-progress"><SongProgress key={loop} songTime={songTime} className="window-progress-fill" /></span>
      <span className="window-controls"><SkipBack weight="fill" /><span className="window-play">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</span><SkipForward weight="fill" /></span>
    </div>
    <div className="window-lyrics">
      <div className="window-sheet" style={{ '--active': index }}>
        {demoSong.lines.map((line, i) => <p key={i} className={'window-line' + (i === index ? ' is-active' : i < index ? ' is-passed' : '')}
          style={{ '--distance': Math.min(3, Math.abs(i - index)) }}>{line.text}</p>)}
      </div>
    </div>
  </div>;
}

export function FloatingIsland({ position }) {
  const { index, loop, lineOffset, songTime } = position;
  const line = demoSong.lines[index];
  const next = demoSong.lines[(index + 1) % demoSong.lines.length];
  return <div className="surface surface-island">
    <span className="island-art">
      <DemoArtwork />
      <svg viewBox="0 0 44 44"><rect className="island-ring-track" x="2" y="2" width="40" height="40" rx="9" />
        <SongRing key={loop} songTime={songTime} /></svg>
    </span>
    <span className="island-lines">
      <SungLine key={loop + '-' + index} line={line} offset={lineOffset} className="island-current" />
      <span className="island-next">{next.text}</span>
    </span>
    <span className="island-bars"><i /><i /><i /><i /></span>
  </div>;
}

function SongRing({ songTime }) {
  const [delay] = useState(() => -songTime);
  return <rect className="island-ring-fill" x="2" y="2" width="40" height="40" rx="9" pathLength="100"
    style={{ animationDelay: `${delay}s`, animationDuration: `${DURATION}s` }} />;
}

export function KaraokeOverlay({ position, lines = 2, className = '', style }) {
  const { index, loop, lineOffset } = position;
  const line = demoSong.lines[index];
  const next = demoSong.lines[(index + 1) % demoSong.lines.length];
  return <div className={'surface surface-overlay ' + className} style={style}>
    <SungLine key={loop + '-' + index} line={line} offset={lineOffset} className="overlay-current" />
    {lines > 1 && <span className="overlay-next">{next.text}</span>}
  </div>;
}
