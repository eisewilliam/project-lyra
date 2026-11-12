import { getRouteApi, useHydrated } from '@tanstack/react-router';
import { motion, type Variants } from 'motion/react';
import { ExternalLink } from '../components/ExternalLink.tsx';
import { OsIcon } from '../components/OsIcons.tsx';
import { StaffLines } from '../components/StaffLines.tsx';
import { Terminal } from '../components/Terminal.tsx';
import { useVisitorPlatform } from '../hydration.ts';
import { platformDetails, platformNames, platforms, playersAndOthers, siteConfig, type Platform } from '../site-config.ts';

const route = getRouteApi('/download');
const ease = [0.2, 0.8, 0.2, 1] as const;
const rowIn: Variants = { hidden: { opacity: 0, y: 18 }, shown: { opacity: 1, y: 0, transition: { duration: 0.55, ease } } };

function PlatformRow({ id, detected, featured }: { id: Platform; detected: boolean; featured: boolean }) {
  const url = siteConfig.downloads[id];
  const details = platformDetails[id];
  return <motion.article className={'platform-row' + (featured ? ' is-featured' : '')} aria-labelledby={id + '-name'} variants={rowIn}>
    <div className="platform-name">
      <OsIcon platform={id} className="platform-icon" />
      <div>
        <h2 id={id + '-name'}>{platformNames[id]}</h2>
        {detected && <p className="platform-tag">This computer</p>}
      </div>
    </div>
    <dl className="platform-facts">
      <div><dt>You need</dt><dd>{details.needs.join('. ')}.</dd></div>
      <div><dt>How it listens</dt><dd>{details.playback}</dd></div>
      {!siteConfig.signed[id] && details.firstLaunch && <div><dt>First launch</dt><dd>{details.firstLaunch}</dd></div>}
    </dl>
    <div className="platform-action">
      {url
        ? <a className="button button-primary button-medium" href={url}>Download for {platformNames[id]}</a>
        : <p className="pending-release">Coming soon</p>}
    </div>
  </motion.article>;
}

const buildSteps = [
  'git clone https://github.com/eisewilliam/project-lyra.git',
  'cd project-lyra',
  'make install',
  'make build',
];

export function DownloadPage() {
  const hydrated = useHydrated();
  const detected = useVisitorPlatform();
  // The page is prerendered without a query string, so `?platform=` applies
  // once it is hydrated.
  const { platform: requested } = route.useSearch();
  const highlight = (hydrated ? requested : undefined) ?? detected;
  const order = highlight ? [highlight, ...platforms.filter(id => id !== highlight)] : platforms;
  return <main id="main-content" className="download-page">
    <section className="download-intro" aria-labelledby="download-title">
      <StaffLines id="download-staff" className="download-staff"
        lyrics={[[1, 'carry a little light with you', '14%'], [3, 'and still the melody stays', '52%']]} />
      <h1 id="download-title" tabIndex={-1}>Download Lyra</h1>
      <p className="lead">Free for macOS, Windows and Linux. Lyra works with {playersAndOthers}.</p>
      {hydrated && !detected && <p className="device-note">Lyra is a desktop app. Open this page on your Mac, Windows or Linux computer to download it.</p>}
    </section>

    <motion.section className="platform-list" aria-label="Downloads by platform" initial="hidden" animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } }}>
      {order.map(id => <PlatformRow key={id} id={id} detected={id === detected} featured={id === highlight} />)}
    </motion.section>

    <section className="build-source" id="build-from-source" aria-labelledby="build-title">
      <div className="build-copy">
        <h2 id="build-title">Build it yourself</h2>
        <p className="lead">Lyra is open source, so you can build it today on any of the three platforms.</p>
        <ul className="prerequisites">
          <li>Rust stable, installed with rustup</li>
          <li>Node.js 18 or newer, and pnpm</li>
          <li>Your platform’s build tools: Xcode Command Line Tools on macOS, Microsoft C++ Build Tools on Windows, WebKitGTK and its companions on Linux</li>
        </ul>
        <ExternalLink className="text-link" href={siteConfig.repository + '#getting-started'}>Full instructions on GitHub</ExternalLink>
      </div>
      <Terminal lines={buildSteps} copy />
    </section>

    <section className="release-notes" aria-labelledby="releases-title">
      <h2 id="releases-title">Every version, in one place</h2>
      <p>Release notes and all published builds live on GitHub.</p>
      <ExternalLink className="button button-secondary button-medium" href={siteConfig.releases}>See releases on GitHub</ExternalLink>
    </section>
  </main>;
}
