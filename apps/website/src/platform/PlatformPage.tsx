import { Link } from '@tanstack/react-router';
import { OsIcon } from '../components/OsIcons.tsx';
import { StaffLines, type StaffLyric } from '../components/StaffLines.tsx';
import { Terminal } from '../components/Terminal.tsx';
import { installers, platformDetails, platformNames, siteConfig, type Platform } from '../site-config.ts';

interface PlatformCopy {
  lead: string;
  /** Under the platform's name: what the build runs on. */
  runsOn: string;
  install: string[];
  /** Install commands, for platforms installed from a terminal. */
  commands?: string[];
  lyrics: StaffLyric[];
}

// Facts grounded in the repository README, docs/RELEASING.md and the platform
// adapters; requirements and playback come from site-config.
const copy: Record<Platform, PlatformCopy> = {
  macos: {
    lead: 'Lyra follows Spotify, Apple Music and anything else in Now Playing, and shows synced lyrics in its own window, a floating panel or a karaoke overlay. It runs from the menu bar.',
    runsOn: 'Apple silicon and Intel',
    install: [
      'Open Lyra-macos-universal.dmg and drag Lyra to Applications.',
      'Open Lyra. It lives in the menu bar.',
      'Play a song. macOS asks once before Lyra can see Spotify or Music.',
    ],
    lyrics: [[1, 'a light in the menu bar', '14%'], [3, 'the words right where you are', '52%']],
  },
  windows: {
    lead: 'Lyra follows Spotify, Apple Music, browsers and other players in the Windows media controls, and shows synced lyrics in its own window, a floating panel or a karaoke overlay. It runs from the system tray.',
    runsOn: 'Windows 10 and 11, 64-bit',
    install: [
      'Run Lyra-windows-x64-setup.exe. The .msi installs the same app, for setups that use Windows Installer.',
      'Open Lyra. It lives in the system tray.',
      'Play a song, and the lyrics follow along.',
    ],
    lyrics: [[1, 'a light in the system tray', '14%'], [3, 'the words right where you are', '52%']],
  },
  linux: {
    lead: 'Lyra follows Spotify, browsers and any other player that supports MPRIS, and shows synced lyrics in its own window, a floating panel or a karaoke overlay. It works the same across distributions.',
    runsOn: '64-bit, most distributions',
    install: [
      'Download the AppImage, the .deb or the .rpm.',
      'Make the AppImage executable and run it, or install the package with your package manager.',
      'Play a song, and the lyrics follow along.',
    ],
    commands: [
      '# AppImage',
      'chmod +x Lyra-linux-amd64.AppImage',
      './Lyra-linux-amd64.AppImage',
      '',
      '# Debian and Ubuntu',
      'sudo apt install ./Lyra-linux-amd64.deb',
      '',
      '# Fedora',
      'sudo dnf install ./Lyra-linux-x86_64.rpm',
      '',
      '# openSUSE',
      'sudo zypper install ./Lyra-linux-x86_64.rpm',
    ],
    lyrics: [[1, 'one song on every desktop', '14%'], [3, 'the words right where you are', '52%']],
  },
};

// The page for one platform: what Lyra does there, what it needs, every
// installer, and how to install it.
export function PlatformPage({ platform }: { platform: Platform }) {
  const name = platformNames[platform];
  const details = platformDetails[platform];
  const page = copy[platform];
  const [primary, ...others] = installers[platform];
  const primaryUrl = siteConfig.download(primary.file);
  return <main id="main-content" className="download-page platform-page">
    <section className="download-intro" aria-labelledby="platform-title">
      <StaffLines id="platform-staff" className="download-staff" lyrics={page.lyrics} />
      <h1 id="platform-title" tabIndex={-1}>{`Lyra for ${name}`}</h1>
      <p className="lead">{page.lead}</p>
      <div className="hero-actions">
        {primaryUrl
          ? <a className="button button-primary button-large" href={primaryUrl}>
            <OsIcon platform={platform} className="button-icon" /><span>{`Download for ${name}`}</span>
          </a>
          : <p className="pending-release">Coming soon</p>}
        <Link className="text-link" to="/download">Other platforms</Link>
      </div>
    </section>

    <section className="platform-list" aria-label={`Lyra on ${name}`}>
      <article className="platform-row is-featured" aria-labelledby="platform-name">
        <div className="platform-name">
          <OsIcon platform={platform} className="platform-icon" />
          <div>
            <h2 id="platform-name">{name}</h2>
            <p className="platform-tag">{page.runsOn}</p>
          </div>
        </div>
        <dl className="platform-facts">
          <div><dt>You need</dt><dd>{details.needs.join('. ')}.</dd></div>
          <div><dt>How it listens</dt><dd>{details.playback}</dd></div>
          {!siteConfig.signed[platform] && details.firstLaunch && <div><dt>First launch</dt><dd>{details.firstLaunch}</dd></div>}
          <div><dt>Updates</dt><dd>Lyra updates itself in the background when a new version is out.</dd></div>
          <div><dt>Cost</dt><dd>Free and open source, under the MIT license. No account, telemetry or analytics.</dd></div>
        </dl>
        <ul className="platform-action installers" aria-label={`Downloads for ${name}`}>
          {[primary, ...others].map((installer, index) => {
            const url = siteConfig.download(installer.file);
            return <li key={installer.file}>
              {url
                ? <a className={'button button-medium ' + (index === 0 ? 'button-primary' : 'button-secondary')} href={url}>Download {installer.label}</a>
                : <span className="pending-release">{installer.label} coming soon</span>}
              <span className="installer-detail">{installer.detail}</span>
            </li>;
          })}
        </ul>
      </article>
    </section>

    <section className={'build-source' + (page.commands ? '' : ' is-single')} aria-labelledby="install-title">
      <div className="build-copy">
        <h2 id="install-title">Install</h2>
        <ol className="prerequisites install-steps">
          {page.install.map(step => <li key={step}>{step}</li>)}
        </ol>
      </div>
      {page.commands && <Terminal lines={page.commands} />}
    </section>

    <section className="release-notes" aria-labelledby="more-title">
      <h2 id="more-title">Everything else Lyra does</h2>
      <p>The three ways to show lyrics, the players Lyra follows, the settings, and what stays on your computer.</p>
      <Link className="button button-secondary button-medium" to="/">See how Lyra works</Link>
    </section>
  </main>;
}
