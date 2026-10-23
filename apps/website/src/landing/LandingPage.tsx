import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { getRouteApi, Link } from '@tanstack/react-router';
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform,
  type MotionValue, type Transition, type Variants } from 'motion/react';
import { Pause, Play } from '@phosphor-icons/react';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { ExternalLink } from '../components/ExternalLink.tsx';
import { PlayerIcon, type PlayerName } from '../components/PlayerIcons.tsx';
import { StaffLines } from '../components/StaffLines.tsx';
import { playersAndOthers, playersOrOthers, siteConfig, type Platform } from '../site-config.ts';
import { LyricLightField } from '../hero/LyricLightField.tsx';
import { PHRASE_LENGTH, STILL_TIME } from '../hero/phrases.ts';
import { useSongClock, type SongPosition } from '../demo/useSongClock.ts';
import { DemoArtwork, FloatingIsland, KaraokeOverlay, LyraWindow, type IgnoredMedia } from '../demo/surfaces.tsx';
import { paletteStyle, songById, songs, type Song, type SongId } from '../demo/song.ts';

const route = getRouteApi('/');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// QA hook: ?frame=<phrase>:<seconds> renders one still frame of the hero light.
function parseFrame(frame: string | undefined) {
  const match = /^(\d+):(\d+(?:\.\d+)?)$/.exec(frame ?? '');
  return match ? Number(match[1]) * PHRASE_LENGTH + Number(match[2]) : undefined;
}

function useInView(ref: RefObject<Element | null>, threshold = 0.3) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (!target) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold });
    observer.observe(target);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return inView;
}

interface DemoPlayback {
  playing: boolean;
  wantsPlay: boolean;
  toggle: () => void;
  position: SongPosition;
}

// Demo playback runs only while its stage is on screen, and never on its own
// when the visitor prefers reduced motion.
function useDemoPlayback(ref: RefObject<Element | null>, song: Song, threshold = 0.3): DemoPlayback {
  const inView = useInView(ref, threshold);
  const [wantsPlay, setWantsPlay] = useState(() => !reducedMotion());
  const playing = wantsPlay && inView;
  return { playing, wantsPlay, toggle: () => setWantsPlay(value => !value), position: useSongClock(song, playing) };
}

const ease = [0.2, 0.8, 0.2, 1] as const;
// The page's one orchestrated entrance: the hero copy rises out of the light.
// Opacity and a whole `transform` run on the compositor, so the copy stays
// crisp and keeps moving while the hero light sets up on the main thread.
const heroStagger: Variants = { shown: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } };
const heroRise: Variants = {
  hidden: { opacity: 0, transform: 'translateY(28px)' },
  shown: { opacity: 1, transform: 'translateY(0px)', transition: { duration: 0.95, ease } },
};

function Hero({ platform }: { platform: Platform | null }) {
  const search = route.useSearch();
  const [startFrame] = useState(() => parseFrame(search.frame));
  const [lightOn, setLightOn] = useState(() => !reducedMotion() && startFrame === undefined && search.motion !== 'off');
  const [lightSupported, setLightSupported] = useState(true);
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (media.matches) setLightOn(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <section className={'hero ' + (lightOn ? 'motion-on' : 'motion-off')} aria-labelledby="hero-title" ref={heroRef}>
    <LyricLightField playing={lightOn} heroRef={heroRef} copyRef={copyRef}
      startTime={startFrame ?? (reducedMotion() ? STILL_TIME : undefined)} onUnsupported={() => setLightSupported(false)} />
    <motion.div className="hero-copy" ref={copyRef} initial="hidden" animate="shown" variants={heroStagger}>
      <h1 id="hero-title" tabIndex={-1}>
        <motion.span className="hero-line" variants={heroRise}>See your</motion.span>
        <motion.span className="hero-line" variants={heroRise}>Music.</motion.span>
      </h1>
      <motion.p className="hero-lead" variants={heroRise}>Lyra brings live, synced lyrics to wherever you go on your computer, so you can follow along without switching apps.</motion.p>
      <motion.div className="hero-actions" variants={heroRise}>
        <DownloadButton platform={platform} />
        <Link className="text-link" to="/download">Other downloads</Link>
      </motion.div>
    </motion.div>
    {lightSupported && <button type="button" className="motion-control" onClick={() => setLightOn(value => !value)}
      aria-label={lightOn ? 'Pause background animation' : 'Play background animation'}>
      {lightOn ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    </button>}
  </section>;
}

type SurfaceId = 'window' | 'island' | 'overlay';

interface Surface {
  id: SurfaceId;
  name: string;
  text: string;
  detail: string;
}

const surfaces: Surface[] = [
  { id: 'window', name: 'Lyra window', text: 'The whole song: artwork, playback controls and the full lyric sheet, with the current line in focus. Click any line to jump there.', detail: 'The window gets it’s theme from the artwork of your music.' },
  { id: 'island', name: 'Marquee', text: 'A dynamic panel you can place anywhere on your screen. It displays the current and the next line in your song’s lyrics.', detail: 'You can resize to your preference, and set it get out of the way when you hit pause.' },
  { id: 'overlay', name: 'Karaoke overlay', text: 'Follow the lyrics as they fill in, word by word.', detail: 'Add a background so the words stay readable over whatever’s on your screen.' },
];
const sceneLabels: Record<SurfaceId, string> = {
  window: 'The Lyra window showing the demo song’s lyric sheet',
  island: 'The Marquee docked above an open document',
  overlay: 'The karaoke overlay over a bright desktop',
};

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function DemoToggle({ demo, compact = false }: { demo: DemoPlayback; compact?: boolean }) {
  const label = demo.wantsPlay ? 'Pause demo' : 'Play demo';
  return <button type="button" className={'demo-toggle' + (compact ? ' is-compact' : '')} onClick={demo.toggle} aria-label={compact ? label : undefined}>
    {demo.wantsPlay ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    {!compact && <span>{label}</span>}
  </button>;
}

function SongPicker({ song, onChange, name }: { song: Song; onChange: (id: SongId) => void; name: string }) {
  return <fieldset className="song-picker">
    <legend className="visually-hidden">Demo song</legend>
    {songs.map(option => <label key={option.id} className="song-option" title={option.title} style={paletteStyle(option)}>
      <input type="radio" name={name} value={option.id} checked={song.id === option.id} onChange={() => onChange(option.id)} />
      <DemoArtwork song={option} className="song-swatch" />
      {song.id === option.id && <motion.span className="song-ring" layoutId={'ring-' + name} transition={spring} />}
      <span className="visually-hidden">{option.title}</span>
    </label>)}
  </fieldset>;
}

// Desk content for the island scene: an abstract document, not a real app.
function WorkSheet() {
  return <span className="scene-work" aria-hidden="true">
    <i className="work-title" /><i /><i /><i className="is-short" /><i /><i /><i className="is-short" />
  </span>;
}

const spring: Transition = { type: 'spring', stiffness: 320, damping: 32 };
// Scene changes are meant to be seen: the old surface lifts away and the new
// one rises in from the direction of travel, with a brief blur between them.
const sceneVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 14}%`, scale: 0.9, filter: 'blur(12px)' }),
  center: { opacity: 1, y: '0%', scale: 1, filter: 'blur(0px)' },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -10}%`, scale: 1.04, filter: 'blur(12px)', transition: { duration: 0.4, ease: [0.4, 0, 1, 1] } }),
};
const sceneTransition: Transition = { type: 'spring', stiffness: 150, damping: 22, mass: 0.9, opacity: { duration: 0.35 }, filter: { duration: 0.4 } };

interface SceneProps {
  surface: SurfaceId;
  song: Song;
  demo: DemoPlayback;
}

function SceneContent({ surface, song, demo }: SceneProps) {
  if (surface === 'window') return <LyraWindow song={song} position={demo.position} playing={demo.playing} />;
  if (surface === 'island') return <><WorkSheet /><FloatingIsland song={song} position={demo.position} /></>;
  return <KaraokeOverlay song={song} position={demo.position} className="is-bottom" style={{ '--overlay-bg': 0.5 }} />;
}

// The screen leans slightly towards the pointer, so the scene feels like an object.
function useTilt() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [3, -3]), { stiffness: 140, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-4, 4]), { stiffness: 140, damping: 18 });
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - box.left) / box.width - 0.5);
    y.set((event.clientY - box.top) / box.height - 0.5);
  };
  const onPointerLeave = () => { x.set(0); y.set(0); };
  return { style: { rotateX, rotateY }, onPointerMove, onPointerLeave };
}

function Scene({ surface, song, demo, onSongChange, pickerName, direction = 1 }: SceneProps & {
  onSongChange: (id: SongId) => void;
  pickerName: string;
  direction?: number;
}) {
  const tilt = useTilt();
  return <motion.figure className={'scene' + (demo.playing ? ' is-playing' : '')} style={tilt.style}
    onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
    <div className="scene-screen" role="img" aria-label={`${sceneLabels[surface]}, playing ${song.title} (${song.artist})`}>
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div key={surface} className={'scene-content scene-' + surface} custom={direction}
          variants={sceneVariants} initial="enter" animate="center" exit="exit" transition={sceneTransition}>
          <span className="scene-wallpaper" />
          <SceneContent surface={surface} song={song} demo={demo} />
        </motion.div>
      </AnimatePresence>
    </div>
    <figcaption className="now-playing">
      <DemoArtwork song={song} className="now-playing-art" />
      <span className="now-playing-text">
        <AnimatePresence initial={false} mode="wait">
          <motion.span key={song.id} className="now-playing-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease }}>
            <span>{song.title}</span><span>{song.artist}</span>
          </motion.span>
        </AnimatePresence>
      </span>
      <SongPicker song={song} onChange={onSongChange} name={pickerName} />
      <DemoToggle demo={demo} compact />
    </figcaption>
  </motion.figure>;
}

function StepText({ item, id }: { item: Surface; id: string }) {
  return <>
    <h3 id={id}>{item.name}</h3>
    <p>{item.text}</p>
    <p className="story-detail">{item.detail}</p>
  </>;
}

interface RailSegmentProps {
  progress: MotionValue<number>;
  index: number;
  count: number;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}

function RailSegment({ progress, index, count, active, onSelect, children }: RailSegmentProps) {
  const fill = useTransform(progress, [index / count, (index + 1) / count], [0, 1]);
  return <li>
    <button type="button" aria-current={active ? 'step' : undefined} onClick={onSelect}>
      <span className="rail-track"><motion.span className="rail-fill" style={{ scaleX: fill }} /></span>
      {children}
    </button>
  </li>;
}

const textVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: direction * 28 }),
  center: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
  exit: (direction: number) => ({ opacity: 0, y: direction * -20, transition: { duration: 0.2, ease: 'easeIn' } }),
};

// Wide screens pin the section while it scrolls past. Scroll position picks
// the surface directly: about forty percent of a screen moves to the next one.
function PinnedStory({ song, demo, onSongChange }: { song: Song; demo: DemoPlayback; onSongChange: (id: SongId) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const [step, setStep] = useState({ index: 0, direction: 1 });
  useMotionValueEvent(scrollYProgress, 'change', value => {
    const index = Math.min(surfaces.length - 1, Math.max(0, Math.floor(value * surfaces.length)));
    setStep(current => (current.index === index ? current : { index, direction: index > current.index ? 1 : -1 }));
  });
  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const travel = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (travel * (index + 0.5)) / surfaces.length, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  // The index is clamped to the list above.
  const item = surfaces[step.index]!;
  return <div className="story-track" ref={trackRef} style={{ '--steps': surfaces.length }}>
    <div className="story-pin">
      <div className="story-copy">
        <ol className="story-rail" aria-label="Surfaces">
          {surfaces.map((entry, index) => <RailSegment key={entry.id} progress={scrollYProgress} index={index} count={surfaces.length}
            active={index === step.index} onSelect={() => goTo(index)}>{entry.name}</RailSegment>)}
        </ol>
        <div className="story-text-frame" aria-live="polite">
          <AnimatePresence initial={false} custom={step.direction} mode="wait">
            <motion.div key={item.id} className="story-text" custom={step.direction} variants={textVariants} initial="enter" animate="center" exit="exit">
              <StepText item={item} id="story-step-title" />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="story-stage">
        <Scene surface={item.id} direction={step.direction} song={song} demo={demo} onSongChange={onSongChange} pickerName="song-stage" />
      </div>
    </div>
  </div>;
}

function Surfaces() {
  const sectionRef = useRef<HTMLElement>(null);
  const [songId, setSongId] = useState<SongId>('shenandoah');
  const song = songById(songId);
  const demo = useDemoPlayback(sectionRef, song, 0.1);
  const pinned = useMediaQuery('(min-width: 960px) and (min-height: 620px)');
  return <section className="section surfaces" id="surfaces" aria-labelledby="surfaces-title" ref={sectionRef} style={paletteStyle(song)}>
    <div className="surfaces-wash" aria-hidden="true" />
    <div className="section-head">
      <h2 id="surfaces-title">Choose from 3 options.</h2>
      <p className="lead">Lyra finds synced lyrics for your music. You decide how it is displayed.</p>
    </div>
    {pinned
      ? <PinnedStory song={song} demo={demo} onSongChange={setSongId} />
      : <div className="story-stack">
        {surfaces.map(item => <article key={item.id} className="story-step" aria-labelledby={'step-' + item.id}>
          <StepText item={item} id={'step-' + item.id} />
          <Scene surface={item.id} song={song} demo={demo} onSongChange={setSongId} pickerName={'song-' + item.id} />
        </article>)}
      </div>}
  </section>;
}

// Players section: the same Lyra window follows whichever player is chosen,
// and declines a video. Each player plays a different public-domain demo song.
const neutralPalette: Pick<Song, 'palette'> = { palette: { deep: '#07090a', a: '#3d4b4d', b: '#1c2628', c: '#c7d5d3' } };

interface Source {
  id: string;
  icon: PlayerName;
  name: string;
  where?: string;
  song: SongId;
  ignored?: IgnoredMedia;
  detail: string;
}

const sources: Source[] = [
  { id: 'spotify', icon: 'spotify', name: 'Spotify', song: 'shenandoah',
    detail: 'Lyra reads Spotify directly. The mark on the artwork opens the track in Spotify.' },
  { id: 'apple-music', icon: 'appleMusic', name: 'Apple Music', song: 'greensleeves',
    detail: 'Streaming and your own library, including music files you added yourself.' },
  { id: 'youtube-music', icon: 'youtubeMusic', name: 'YouTube Music', where: 'in a browser', song: 'dannyboy',
    detail: 'Music playing in a browser counts too. Lyra asks once before looking up its lyrics.' },
  { id: 'video', icon: 'youtube', name: 'A video', where: 'in a browser', song: 'dannyboy',
    ignored: { title: 'How sourdough bread is made', where: 'YouTube in a browser' },
    detail: 'Not music, so Lyra stays out of the way. If it gets one wrong, one click shows the lyrics anyway.' },
];

function Players() {
  const stageRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState(sources[0]!);
  const song = songById(source.song);
  const demo = useDemoPlayback(stageRef, song);
  const label = source.ignored
    ? 'The Lyra window not following a video playing in a browser'
    : `The Lyra window showing ${song.title} playing in ${source.name}`;
  return <section className="section players" id="players" aria-labelledby="players-title"
    style={paletteStyle(source.ignored ? neutralPalette : song)}>
    <div className="section-head">
      <h2 id="players-title">Wherever you listen.</h2>
      <p className="lead">Lyra works with Spotify, Apple Music, YouTube Music, and most players that appear in your computer’s media controls. When you’re playing something that isn’t music, Lyra stays out of the way.</p>
    </div>
    <div className="players-body">
      <figure className={'players-stage scene' + (demo.playing ? ' is-playing' : '')} ref={stageRef}>
        <div className="scene-screen" role="img" aria-label={label}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={source.id} className="scene-content scene-window"
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(10px)', transition: { duration: 0.3 } }} transition={{ duration: 0.5, ease }}>
              <span className="scene-wallpaper" />
              <LyraWindow song={song} position={demo.position} playing={demo.playing} source={source.icon} ignored={source.ignored ?? null} />
            </motion.div>
          </AnimatePresence>
        </div>
      </figure>
      <div className="players-controls">
        <fieldset className="player-picker">
          <legend>Playing in</legend>
          {sources.map(option => <label key={option.id} className="player-option">
            <input type="radio" name="player-source" value={option.id} checked={option === source}
              onChange={() => setSource(option)} />
            {option === source && <motion.span className="player-option-indicator" layoutId="player-option" transition={spring} />}
            <PlayerIcon player={option.icon} />
            <span className="player-option-name">{option.name}{option.where && <span> {option.where}</span>}</span>
          </label>)}
        </fieldset>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={source.id} className="players-detail" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }}>{source.detail}</motion.p>
        </AnimatePresence>
        <DemoToggle demo={demo} />
      </div>
    </div>
  </section>;
}

type OverlaySetting = 'position' | 'align' | 'lines' | 'scale' | 'background';
type OverlaySettings = Record<OverlaySetting, string>;

const choices: { name: OverlaySetting; label: string; options: [value: string, label: string][] }[] = [
  { name: 'position', label: 'Position', options: [['top', 'Top'], ['bottom', 'Bottom']] },
  { name: 'align', label: 'Alignment', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
  { name: 'lines', label: 'Lines', options: [['1', 'One line'], ['2', 'Two lines']] },
  { name: 'scale', label: 'Text size', options: [['0.75', '75%'], ['1', '100%'], ['1.5', '150%']] },
  { name: 'background', label: 'Background', options: [['0', 'None'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%']] },
];
const moreSettings = [
  'Hide lyric displays when playback pauses or stops.',
  'Launch Lyra when your computer starts.',
  'Choose a light, dark, or automatic theme.',
  'Choose which screen displays your lyrics.',
  'Customize lyric font, size, and color.',
  'Fine-tune lyric timing, with adjustments saved for individual songs.',
];

function Customize() {
  const previewRef = useRef<HTMLDivElement>(null);
  const song = songById('dannyboy');
  const demo = useDemoPlayback(previewRef, song);
  const [settings, setSettings] = useState<OverlaySettings>({ position: 'bottom', align: 'center', lines: '2', scale: '1', background: '0.25' });
  return <section className="section customize" aria-labelledby="customize-title" style={paletteStyle(song)}>
    <div className="customize-copy">
      <h2 id="customize-title">Make it your own.</h2>
      <p className="lead">Tune Lyra to your setup. Adjust the lyric font, size, color, timing, and screen placement.</p>
      <form className="choice-groups" onSubmit={event => event.preventDefault()}>
        {choices.map(({ name, label: groupLabel, options }) => <fieldset className="choice-group" key={name}>
          <legend>{groupLabel}</legend>
          <div className="segmented">
            {options.map(([value, label]) => <label key={value}>
              <input type="radio" name={name} value={value} checked={settings[name] === value}
                onChange={() => setSettings(current => ({ ...current, [name]: value }))} />
              {settings[name] === value && <motion.span className="segmented-indicator" layoutId={'choice-' + name} transition={spring} />}
              <span>{label}</span>
            </label>)}
          </div>
        </fieldset>)}
      </form>
    </div>
    <div className="customize-preview">
      <div className={'preview-screen' + (demo.playing ? ' is-playing' : '')} ref={previewRef}
        role="img" aria-label={`Karaoke overlay preview: ${settings.position}, ${settings.align} aligned, ${settings.lines === '1' ? 'one line' : 'two lines'}`}>
        <KaraokeOverlay layout song={song} position={demo.position} lines={Number(settings.lines)}
          className={`is-${settings.position} align-${settings.align}`}
          style={{ '--overlay-scale': settings.scale, '--overlay-bg': settings.background }} />
      </div>
      <div className="preview-caption"><DemoToggle demo={demo} /></div>
      <div className="more-settings">
        <h3>More in settings</h3>
        <ul>{moreSettings.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  </section>;
}

const steps: [title: string, text: string][] = [
  ['Install Lyra', 'Download and open Lyra. It runs from your menu bar or system tray.'],
  ['Press play', 'Play music on Spotify, Apple Music, YouTube Music, or another supported player. Lyra looks up synced lyrics for you.'],
  ['Follow along', 'Choose your preferred lyric view from the tray, then keep the words close while you code, design, work, or do your thing.'],
];

function Steps() {
  return <section className="section steps" aria-labelledby="steps-title">
    <div className="section-head">
      <h2 id="steps-title">Set it up once.</h2>
      <p className="lead">After that, Lyra follows your music on its own.</p>
    </div>
    <ol className="measures">
      {steps.map(([title, text], index) => <li key={title} className="measure">
        <motion.span className="measure-number" aria-hidden="true" initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }} transition={{ duration: 0.4, delay: 0.25 + index * 0.35, ease }}>{index + 1}</motion.span>
        <motion.span className="measure-staff" aria-hidden="true" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.8 }} transition={{ duration: 0.6, delay: index * 0.35, ease }} />
        <h3>{title}</h3>
        <p>{text}</p>
      </li>)}
    </ol>
  </section>;
}

const credits: [role: string, value: ReactNode][] = [
  ['Lyrics', 'LRCLIB, a community-maintained lyrics database'],
  ['Playback', `Read from the players on your computer: ${playersAndOthers}. Lyra doesn’t use any streaming service’s web API.`],
  ['Storage', 'Lyrics are cached on your computer. Your own .lrc file can replace any song’s lyrics.'],
  ['Account', 'None'],
  ['Telemetry', 'None, and no analytics'],
  ['License', 'MIT, free to use, read and change'],
  ['Made by', <><ExternalLink className="text-link" href={siteConfig.maker.profile}>@{siteConfig.maker.handle}</ExternalLink> on GitHub, as an independent project</>],
];

function LinerNotes() {
  return <section className="section liner" id="privacy" aria-labelledby="liner-title">
    <div className="liner-sleeve">
      <div className="liner-page liner-cover">
        <h2 id="liner-title">Liner notes</h2>
        <p className="lead">What Lyra uses, what it keeps on your computer, and who made it.</p>
        <div className="liner-actions">
          <ExternalLink className="button button-secondary button-medium" href={siteConfig.repository}>Star on GitHub</ExternalLink>
          <ExternalLink className="text-link" href={siteConfig.repository}>Read the source</ExternalLink>
        </div>
      </div>
      <motion.dl className="liner-page credits" initial="tucked" whileInView="out" viewport={{ once: true, amount: 0.4 }}
        variants={{ tucked: { x: '-18%', opacity: 0 }, out: { x: '0%', opacity: 1, transition: { duration: 0.8, ease, staggerChildren: 0.06, delayChildren: 0.25 } } }}>
        {credits.map(([role, value]) => <motion.div key={role} variants={{ tucked: { opacity: 0, x: -14 }, out: { opacity: 1, x: 0, transition: { duration: 0.4, ease } } }}>
          <dt>{role}</dt><dd>{value}</dd>
        </motion.div>)}
      </motion.dl>
    </div>
  </section>;
}

const faqs: [question: string, answer: string][] = [
  ['What do I need to use Lyra?', `A Mac, a Windows PC or a Linux computer, and a music player: ${playersOrOthers}. Start a song and Lyra follows along.`],
  ['Does it work with every song?', 'Lyrics come from LRCLIB, a community database, so coverage varies. Songs with synced lyrics move with the music. If only plain lyrics exist, Lyra shows them without timing. If there are none, Lyra tells you, and you can retry or add your own .lrc file.'],
  ['What does Lyra send over the internet?', 'Only lyric lookups. To find lyrics, Lyra sends LRCLIB the song’s title, artist, album and length. For something playing in a browser, Lyra asks you first. Playback is read on your computer, and there is no account, telemetry or analytics.'],
  ['The lyrics are a little early or late. Can I fix that?', 'Yes. Nudge the timing earlier or later from the Lyra window. The adjustment is remembered for that song.'],
  ['Is Lyra free?', 'Yes. Lyra is an independent, open-source project under the MIT license.'],
  ['Which music players does it work with?', `${playersAndOthers}, including music playing in a browser. If several are playing, Lyra follows the one you started last, or only the player you choose in settings.`],
  ['Will it show lyrics for videos and podcasts?', 'No. Lyra only follows music, so a video, a stream or a podcast episode doesn’t take over your lyrics. If it gets one wrong, show lyrics anyway for that song, or tell Lyra to always or never follow an app.'],
];

function Faq() {
  return <section className="section faq" id="faq" aria-labelledby="faq-title">
    <div className="section-head">
      <h2 id="faq-title">Before you<br />press play.</h2>
    </div>
    <div className="faq-list">
      {faqs.map(([question, answer]) => <details key={question} name="faq">
        <summary>{question}</summary>
        <p>{answer}</p>
      </details>)}
    </div>
  </section>;
}

function Closing({ platform }: { platform: Platform | null }) {
  return <section className="section closing" aria-labelledby="closing-title">
    <div className="closing-staff-band" aria-hidden="true">
      <StaffLines id="closing-staff" className="closing-staff"
        lyrics={[[1, 'we keep a light between us', '18%'], [3, 'keep the song in sight', '60%']]} />
    </div>
    <h2 id="closing-title">Make room<br />for your Music.</h2>
    <p className="lead">Free and open source, for macOS, Windows and Linux.</p>
    <div className="closing-actions">
      <DownloadButton platform={platform} />
      <Link className="text-link" to="/download">Other downloads</Link>
    </div>
    <p className="player-note">Works with {playersAndOthers}.</p>
  </section>;
}

export function LandingPage() {
  const { platform } = route.useRouteContext();
  return <main id="main-content">
    <Hero platform={platform} />
    <Surfaces />
    <Players />
    <Customize />
    <Steps />
    <LinerNotes />
    <Faq />
    <Closing platform={platform} />
  </main>;
}
