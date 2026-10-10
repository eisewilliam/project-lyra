import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react';
import { PlayerIcon } from '../components/PlayerIcons.jsx';

// Illustrative recreations of Lyra's surfaces, modelled on the desktop app's
// own views. Purely visual: the surrounding figure carries the accessible label.
// Colour comes from the song's artwork, as Lyra blurs the artwork behind its views.

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
function SongProgress({ song, songTime, className }) {
  const [delay] = useState(() => -songTime);
  return <span className={className} style={{ animationDelay: `${delay}s`, animationDuration: `${song.duration}s` }} />;
}

export function DemoArtwork({ song, className = '' }) {
  return <span className={'demo-art ' + className} data-art={song.art}><span /></span>;
}

// Long lines wrap, as in the app, so the sheet centres the active line by
// measuring it rather than assuming a fixed row height.
function useActiveLineOffset(index, songId, shown = true) {
  const sheetRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    const update = () => {
      const active = sheet.children[index];
      if (active) setOffset(active.offsetTop + active.offsetHeight / 2);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [index, songId, shown]);
  return [sheetRef, offset];
}

// What the app's lyric pane says about media it decided not to follow.
function IgnoredNote({ ignored }) {
  return <div className="window-ignored">
    <span className="window-ignored-title">Not following “{ignored.title}”</span>
    <span className="window-ignored-reason">{ignored.where}. Looks like a video, not music.</span>
    <span className="window-ignored-action">Show lyrics anyway</span>
  </div>;
}

// `source` puts the player's mark on the artwork, as the app does; with
// `ignored` the window shows how Lyra declines media that isn't music.
export function LyraWindow({ song, position, playing, source = null, ignored = null }) {
  const { index, loop, songTime } = position;
  const [sheetRef, offset] = useActiveLineOffset(index, song.id, !ignored);
  return <div className="surface surface-window">
    <span className="window-ambient" aria-hidden="true" />
    <div className="window-sidebar">
      <span className="window-dots"><i /><i /><i /></span>
      <span className="window-art-frame">
        {ignored ? <span className="window-art is-empty" /> : <DemoArtwork song={song} className="window-art" />}
        {source && !ignored && <span className="window-source"><PlayerIcon player={source} /></span>}
      </span>
      {ignored
        ? <span className="window-skeleton"><i /><i /></span>
        : <><span className="window-title">{song.title}</span><span className="window-artist">{song.artist}</span></>}
      <span className="window-progress"><SongProgress key={song.id + loop} song={song} songTime={songTime} className="window-progress-fill" /></span>
      <span className="window-controls"><SkipBack weight="fill" /><span className="window-play">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</span><SkipForward weight="fill" /></span>
    </div>
    <div className="window-lyrics">
      {ignored ? <IgnoredNote ignored={ignored} /> : <div className="window-sheet" ref={sheetRef} style={{ transform: `translateY(${-offset}px)` }}>
        {song.lines.map((line, i) => <p key={i} className={'window-line' + (i === index ? ' is-active' : i < index ? ' is-passed' : '')}
          style={{ '--distance': Math.min(3, Math.abs(i - index)) }}>{line.text}</p>)}
      </div>}
    </div>
  </div>;
}

function SongRing({ song, songTime }) {
  const [delay] = useState(() => -songTime);
  return <rect className="island-ring-fill" x="2" y="2" width="40" height="40" rx="9" pathLength="100"
    style={{ animationDelay: `${delay}s`, animationDuration: `${song.duration}s` }} />;
}

// Lines wider than the island slide across while they are sung, like the
// app's gliding line.
function GlidingLine({ line, offset, className }) {
  const viewportRef = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const update = () => setShift(Math.max(0, viewport.firstChild.offsetWidth - viewport.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [line]);
  const style = shift ? { '--glide': `${-shift}px`, animationDuration: `${(line.end - line.time) * 0.82}s`, animationDelay: `${-offset}s` } : undefined;
  return <span className={'glide ' + className} ref={viewportRef}>
    <span className={'glide-content' + (shift ? ' is-gliding' : '')} style={style}><SungLine line={line} offset={offset} /></span>
  </span>;
}

export function FloatingIsland({ song, position }) {
  const { index, loop, lineOffset, songTime } = position;
  const line = song.lines[index];
  const next = song.lines[(index + 1) % song.lines.length];
  return <div className="surface surface-island">
    <span className="island-art">
      <DemoArtwork song={song} />
      <svg viewBox="0 0 44 44"><rect className="island-ring-track" x="2" y="2" width="40" height="40" rx="9" />
        <SongRing key={song.id + loop} song={song} songTime={songTime} /></svg>
    </span>
    <span className="island-lines">
      <GlidingLine key={song.id + loop + '-' + index} line={line} offset={lineOffset} className="island-current" />
      <span className="island-next">{next.text}</span>
    </span>
    <span className="island-bars"><i /><i /><i /><i /></span>
  </div>;
}

const overlaySpring = { type: 'spring', stiffness: 260, damping: 30 };

// With `layout`, position, alignment and line changes spring into place.
export function KaraokeOverlay({ song, position, lines = 2, className = '', style, layout = false }) {
  const { index, loop, lineOffset } = position;
  const line = song.lines[index];
  const next = song.lines[(index + 1) % song.lines.length];
  const Box = layout ? motion.div : 'div';
  const Line = layout ? motion.span : 'span';
  const motionProps = value => (layout ? { layout: value, transition: overlaySpring } : {});
  return <Box className={'surface surface-overlay ' + className} style={style} {...motionProps(true)}>
    <Line className="overlay-line" {...motionProps('position')}>
      <SungLine key={song.id + loop + '-' + index} line={line} offset={lineOffset} className="overlay-current" />
    </Line>
    {lines > 1 && <Line className="overlay-line overlay-next" {...motionProps('position')}>{next.text}</Line>}
  </Box>;
}
