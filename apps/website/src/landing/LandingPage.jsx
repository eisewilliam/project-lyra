import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { Pause, Play } from '@phosphor-icons/react';
import { DownloadButton } from '../components/DownloadButton.jsx';
import { StaffLines } from '../components/StaffLines.jsx';
import { ExternalLink, Link } from '../components/router.jsx';
import { playerApps, playersPlanned, playersToday, siteConfig } from '../site-config.js';
import { LyricLightField } from '../hero/LyricLightField.jsx';
import { PHRASE_LENGTH, STILL_TIME } from '../hero/phrases.js';
import { useSongClock } from '../demo/useSongClock.js';
import { DemoArtwork, FloatingIsland, KaraokeOverlay, LyraWindow } from '../demo/surfaces.jsx';
import { paletteStyle, songs } from '../demo/song.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// QA hook: ?frame=<phrase>:<seconds> renders one still frame of the hero light.
function requestedFrame() {
  const match = /^(\d+):(\d+(?:\.\d+)?)$/.exec(new URLSearchParams(window.location.search).get('frame') || '');
  return match ? Number(match[1]) * PHRASE_LENGTH + Number(match[2]) : undefined;
}

function useInView(ref, threshold = 0.3) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return inView;
}

// Demo playback runs only while its stage is on screen, and never on its own
// when the visitor prefers reduced motion.
function useDemoPlayback(ref, song, threshold = 0.3) {
  const inView = useInView(ref, threshold);
  const [wantsPlay, setWantsPlay] = useState(() => !reducedMotion());
  const playing = wantsPlay && inView;
  return { playing, wantsPlay, toggle: () => setWantsPlay(value => !value), position: useSongClock(song, playing) };
}

const ease = [0.2, 0.8, 0.2, 1];
// The page's one orchestrated entrance: the hero copy rises out of the light.
const heroStagger = { shown: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } };
const heroRise = {
  hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.95, ease } },
};

function Hero({ platform }) {
  const [startFrame] = useState(requestedFrame);
  const [lightOn, setLightOn] = useState(() => !reducedMotion() && startFrame === undefined
    && new URLSearchParams(window.location.search).get('motion') !== 'off');
  const [lightSupported, setLightSupported] = useState(true);
  const heroRef = useRef(null);
  const copyRef = useRef(null);
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
        <motion.span className="hero-line" variants={heroRise}>Keep the song</motion.span>
        <motion.span className="hero-line" variants={heroRise}>in sight.</motion.span>
      </h1>
      <motion.p className="hero-lead" variants={heroRise}>Live lyrics for the song you’re playing, right on your desktop.</motion.p>
      <motion.div className="hero-actions" variants={heroRise}>
        <DownloadButton platform={platform} />
        <Link className="text-link" to="/download">Other downloads</Link>
      </motion.div>
    </motion.div>
    {lightSupported && <button className="motion-control" onClick={() => setLightOn(value => !value)}
      aria-label={lightOn ? 'Pause background animation' : 'Play background animation'}>
      {lightOn ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    </button>}
  </section>;
}

const surfaces = [
  { id: 'window', name: 'Lyra window', text: 'The whole song: artwork, playback controls and the full lyric sheet, with the current line in focus. Click any line to jump there.', detail: 'The window takes its color from the artwork of whatever is playing.' },
  { id: 'island', name: 'Floating island', text: 'A slim strip docked to the top of your screen, above every app. The line being sung, and the one coming next.', detail: 'Hide it when the music pauses, or move it wherever you like.' },
  { id: 'overlay', name: 'Karaoke overlay', text: 'One or two large lines across your screen, filling word by word as they are sung.', detail: 'Give it a background so it reads over anything, even a bright page.' },
];
const sceneLabels = {
  window: 'The Lyra window showing the demo song’s lyric sheet',
  island: 'The floating island docked above an open document',
  overlay: 'The karaoke overlay over a bright desktop',
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function DemoToggle({ demo, compact = false }) {
  const label = demo.wantsPlay ? 'Pause demo' : 'Play demo';
  return <button className={'demo-toggle' + (compact ? ' is-compact' : '')} onClick={demo.toggle} aria-label={compact ? label : undefined}>
    {demo.wantsPlay ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    {!compact && <span>{label}</span>}
  </button>;
}

function SongPicker({ song, onChange, name }) {
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

const spring = { type: 'spring', stiffness: 320, damping: 32 };
// Scene changes are meant to be seen: the old surface lifts away and the new
// one rises in from the direction of travel, with a brief blur between them.
const sceneVariants = {
  enter: direction => ({ opacity: 0, y: `${direction * 14}%`, scale: 0.9, filter: 'blur(12px)' }),
  center: { opacity: 1, y: '0%', scale: 1, filter: 'blur(0px)' },
  exit: direction => ({ opacity: 0, y: `${direction * -10}%`, scale: 1.04, filter: 'blur(12px)', transition: { duration: 0.4, ease: [0.4, 0, 1, 1] } }),
};
const sceneTransition = { type: 'spring', stiffness: 150, damping: 22, mass: 0.9, opacity: { duration: 0.35 }, filter: { duration: 0.4 } };

function SceneContent({ surface, song, demo }) {
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
  const onPointerMove = event => {
    if (event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - box.left) / box.width - 0.5);
    y.set((event.clientY - box.top) / box.height - 0.5);
  };
  const onPointerLeave = () => { x.set(0); y.set(0); };
  return { style: { rotateX, rotateY }, onPointerMove, onPointerLeave };
}

function Scene({ surface, song, demo, onSongChange, pickerName, direction = 1 }) {
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

function StepText({ item, id }) {
  return <>
    <h3 id={id}>{item.name}</h3>
    <p>{item.text}</p>
    <p className="story-detail">{item.detail}</p>
  </>;
}

function RailSegment({ progress, index, count, active, onSelect, children }) {
  const fill = useTransform(progress, [index / count, (index + 1) / count], [0, 1]);
  return <li>
    <button aria-current={active ? 'step' : undefined} onClick={onSelect}>
      <span className="rail-track"><motion.span className="rail-fill" style={{ scaleX: fill }} /></span>
      {children}
    </button>
  </li>;
}

const textVariants = {
  enter: direction => ({ opacity: 0, y: direction * 28 }),
  center: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
  exit: direction => ({ opacity: 0, y: direction * -20, transition: { duration: 0.2, ease: 'easeIn' } }),
};

// Wide screens pin the section while it scrolls past. Scroll position picks
// the surface directly: about forty percent of a screen moves to the next one.
function PinnedStory({ song, demo, onSongChange }) {
  const trackRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const [step, setStep] = useState({ index: 0, direction: 1 });
  useMotionValueEvent(scrollYProgress, 'change', value => {
    const index = Math.min(surfaces.length - 1, Math.max(0, Math.floor(value * surfaces.length)));
    setStep(current => (current.index === index ? current : { index, direction: index > current.index ? 1 : -1 }));
  });
  const goTo = index => {
    const track = trackRef.current;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const travel = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (travel * (index + 0.5)) / surfaces.length, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const item = surfaces[step.index];
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
  const sectionRef = useRef(null);
  const [songId, setSongId] = useState(songs[0].id);
  const song = songs.find(option => option.id === songId);
  const demo = useDemoPlayback(sectionRef, song, 0.1);
  const pinned = useMediaQuery('(min-width: 960px) and (min-height: 620px)');
  return <section className="section surfaces" id="surfaces" aria-labelledby="surfaces-title" ref={sectionRef} style={paletteStyle(song)}>
    <div className="surfaces-wash" aria-hidden="true" />
    <div className="section-head">
      <h2 id="surfaces-title">Three ways to keep<br />the words close.</h2>
      <p className="lead">Lyra follows what’s playing and finds the synced lyrics. Choose where they appear, and use one surface or all three.</p>
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

const choices = {
  position: [['top', 'Top'], ['bottom', 'Bottom']],
  align: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
  lines: [['1', 'One line'], ['2', 'Two lines']],
  scale: [['0.75', '75%'], ['1', '100%'], ['1.5', '150%']],
  background: [['0', 'None'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%']],
};
const choiceLabels = { position: 'Position', align: 'Alignment', lines: 'Lines', scale: 'Text size', background: 'Background' };
const moreSettings = [
  'Hide surfaces when the music pauses or nothing is playing',
  'Start Lyra with your computer',
  'Light, dark or automatic theme',
  'Pick the screen the surfaces appear on',
  'Lyric font, size and color',
  'Nudge lyric timing earlier or later, remembered for each song',
];

function Customize() {
  const previewRef = useRef(null);
  const song = songs[2];
  const demo = useDemoPlayback(previewRef, song);
  const [settings, setSettings] = useState({ position: 'bottom', align: 'center', lines: '2', scale: '1', background: '0.25' });
  return <section className="section customize" aria-labelledby="customize-title" style={paletteStyle(song)}>
    <div className="customize-copy">
      <h2 id="customize-title">Make it fit<br />your desktop.</h2>
      <p className="lead">Every surface has its own settings. Try a few of the karaoke overlay’s here.</p>
      <form className="choice-groups" onSubmit={event => event.preventDefault()}>
        {Object.entries(choices).map(([name, options]) => <fieldset className="choice-group" key={name}>
          <legend>{choiceLabels[name]}</legend>
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
        <h3>Also in settings</h3>
        <ul>{moreSettings.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  </section>;
}

const steps = [
  ['Install Lyra', 'Download it for your computer and open it. Lyra sits in your menu bar or system tray.'],
  ['Press play', `Lyra sees the track playing in the ${playerApps} and looks up its synced lyrics.`],
  ['Follow along', 'Turn the window, the island or the overlay on or off at any time from the tray.'],
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

const credits = [
  ['Lyrics', 'LRCLIB, a community-maintained lyrics database'],
  ['Playback', `Read from the player on your computer, the ${playerApps} for now. Lyra doesn’t use the Spotify Web API.`],
  ['Storage', 'Lyrics are cached on your computer. Your own .lrc file can replace any song’s lyrics.'],
  ['Account', 'None'],
  ['Telemetry', 'None, and no analytics'],
  ['License', 'MIT, free to use, read and change'],
  ['Made by', 'Olusegun William Eise, as an independent project'],
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

const faqs = [
  ['What do I need to use Lyra?', `A Mac, a Windows PC or a Linux computer with the ${playerApps}. Start a song and Lyra follows along.`],
  ['Does it work with every song?', 'Lyrics come from LRCLIB, a community database, so coverage varies. Songs with synced lyrics move with the music. If only plain lyrics exist, Lyra shows them without timing. If there are none, Lyra tells you, and you can retry or add your own .lrc file.'],
  ['What does Lyra send over the internet?', 'Only lyric lookups. To find lyrics, Lyra sends LRCLIB the song’s title, artist, album and length. Playback is read on your computer, and there is no account, telemetry or analytics.'],
  ['The lyrics are a little early or late. Can I fix that?', 'Yes. Nudge the timing earlier or later from the Lyra window. The adjustment is remembered for that song.'],
  ['Is Lyra free?', 'Yes. Lyra is an independent, open-source project under the MIT license.'],
  ['Does it work with other music players?', `Not yet. The first release follows the ${playerApps}. ${playersPlanned} are planned: Lyra is built so each new player is a new connection to your computer’s playback, not a rewrite.`],
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

function Closing({ platform }) {
  return <section className="section closing" aria-labelledby="closing-title">
    <div className="closing-staff-band" aria-hidden="true">
      <StaffLines id="closing-staff" className="closing-staff"
        lyrics={[[1, 'we keep a light between us', '18%'], [3, 'keep the song in sight', '60%']]} />
    </div>
    <h2 id="closing-title">Make room<br />for the words.</h2>
    <p className="lead">Free and open source, for macOS, Windows and Linux.</p>
    <div className="closing-actions">
      <DownloadButton platform={platform} />
      <Link className="text-link" to="/download">Other downloads</Link>
    </div>
    <p className="player-note">Works with {playersToday} today. {playersPlanned} are planned.</p>
  </section>;
}

export function LandingPage({ platform }) {
  return <main id="main-content">
    <Hero platform={platform} />
    <Surfaces />
    <Customize />
    <Steps />
    <LinerNotes />
    <Faq />
    <Closing platform={platform} />
  </main>;
}
