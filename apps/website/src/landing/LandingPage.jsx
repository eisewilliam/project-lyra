import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from '@phosphor-icons/react';
import { DownloadButton } from '../components/DownloadButton.jsx';
import { StaffLines } from '../components/StaffLines.jsx';
import { ExternalLink, Link } from '../components/router.jsx';
import { playerApps, playersPlanned, playersToday, siteConfig } from '../site-config.js';
import { LyricLightField } from '../hero/LyricLightField.jsx';
import { PHRASE_LENGTH, STILL_TIME } from '../hero/phrases.js';
import { useSongClock } from '../demo/useSongClock.js';
import { FloatingIsland, KaraokeOverlay, LyraWindow } from '../demo/surfaces.jsx';

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
function useDemoPlayback(ref) {
  const inView = useInView(ref);
  const [wantsPlay, setWantsPlay] = useState(() => !reducedMotion());
  const playing = wantsPlay && inView;
  return { playing, wantsPlay, toggle: () => setWantsPlay(value => !value), position: useSongClock(playing) };
}

function Hero({ platform }) {
  const [startFrame] = useState(requestedFrame);
  const [motion, setMotion] = useState(() => !reducedMotion() && startFrame === undefined
    && new URLSearchParams(window.location.search).get('motion') !== 'off');
  const [lightSupported, setLightSupported] = useState(true);
  const heroRef = useRef(null);
  const copyRef = useRef(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (media.matches) setMotion(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <section className={'hero ' + (motion ? 'motion-on' : 'motion-off')} aria-labelledby="hero-title" ref={heroRef}>
    <LyricLightField playing={motion} heroRef={heroRef} copyRef={copyRef}
      startTime={startFrame ?? (reducedMotion() ? STILL_TIME : undefined)} onUnsupported={() => setLightSupported(false)} />
    <div className="hero-copy" ref={copyRef}>
      <h1 id="hero-title" tabIndex={-1}>Keep the song<br />in sight.</h1>
      <p className="hero-lead">Live lyrics for the song you’re playing, right on your desktop.</p>
      <div className="hero-actions">
        <DownloadButton platform={platform} />
        <Link className="text-link" to="/download">Other downloads</Link>
      </div>
    </div>
    {lightSupported && <button className="motion-control" onClick={() => setMotion(value => !value)}
      aria-label={motion ? 'Pause background animation' : 'Play background animation'}>
      {motion ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    </button>}
  </section>;
}

const surfaces = [
  { id: 'window', name: 'Lyra window', text: 'The whole song: artwork, playback controls and the full lyric sheet, with the current line in focus. Click any line to jump there.' },
  { id: 'island', name: 'Floating island', text: 'A slim strip that stays on top, docked to the top of your screen. The line being sung, and the one coming next.' },
  { id: 'overlay', name: 'Karaoke overlay', text: 'One or two large lines across your screen, filling word by word as they are sung.' },
];

function DemoToggle({ demo }) {
  return <button className="demo-toggle" onClick={demo.toggle}>
    {demo.wantsPlay ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    <span>{demo.wantsPlay ? 'Pause demo' : 'Play demo'}</span>
  </button>;
}

function Surfaces() {
  const stageRef = useRef(null);
  const demo = useDemoPlayback(stageRef);
  const [pinned, setPinned] = useState(null);
  const [preview, setPreview] = useState(null);
  const spotlight = preview ?? pinned;
  return <section className="section surfaces" id="surfaces" aria-labelledby="surfaces-title">
    <div className="section-head">
      <h2 id="surfaces-title">Three ways to keep<br />the words close.</h2>
      <p className="lead">Lyra follows what’s playing and finds the synced lyrics. Choose where they appear, and use one surface or all three.</p>
    </div>
    <figure className="stage-figure">
      <div className={'stage' + (demo.playing ? ' is-playing' : '')} data-spotlight={spotlight || undefined} ref={stageRef}
        role="img" aria-label="Lyra’s window, floating island and karaoke overlay showing the same song in sync">
        <div className="stage-glow" />
        <FloatingIsland position={demo.position} />
        <LyraWindow position={demo.position} playing={demo.playing} />
        <KaraokeOverlay position={demo.position} />
      </div>
      <figcaption className="stage-caption">
        <DemoToggle demo={demo} />
        <span>An original demo song, shown the way each surface displays it.</span>
      </figcaption>
    </figure>
    <ul className="surface-list">
      {surfaces.map(surface => <li key={surface.id}>
        <button className="surface-option" aria-pressed={pinned === surface.id}
          onClick={() => setPinned(current => (current === surface.id ? null : surface.id))}
          onPointerEnter={() => setPreview(surface.id)} onPointerLeave={() => setPreview(null)}
          onFocus={() => setPreview(surface.id)} onBlur={() => setPreview(null)}>
          <span className="surface-name">{surface.name}</span>
          <span className="surface-text">{surface.text}</span>
        </button>
      </li>)}
    </ul>
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
  const demo = useDemoPlayback(previewRef);
  const [settings, setSettings] = useState({ position: 'bottom', align: 'center', lines: '2', scale: '1', background: '0.25' });
  return <section className="section customize" aria-labelledby="customize-title">
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
              <span>{label}</span>
            </label>)}
          </div>
        </fieldset>)}
      </form>
    </div>
    <div className="customize-preview">
      <div className={'preview-screen' + (demo.playing ? ' is-playing' : '')} ref={previewRef}
        role="img" aria-label={`Karaoke overlay preview: ${settings.position}, ${settings.align} aligned, ${settings.lines === '1' ? 'one line' : 'two lines'}`}>
        <KaraokeOverlay position={demo.position} lines={Number(settings.lines)}
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
        <span className="measure-number" aria-hidden="true">{index + 1}</span>
        <span className="measure-staff" aria-hidden="true" />
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
      <dl className="liner-page credits">
        {credits.map(([role, value]) => <div key={role}><dt>{role}</dt><dd>{value}</dd></div>)}
      </dl>
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
