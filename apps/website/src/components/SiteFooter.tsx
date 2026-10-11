import { Link } from '@tanstack/react-router';
import { siteConfig } from '../site-config.ts';
import { ExternalLink } from './ExternalLink.tsx';

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-inner">
      <img src="/assets/lyra-logo.svg" width="76" height="36" alt="Lyra" />
      <p className="footer-note">A free, open-source lyrics companion. Not affiliated with Spotify, Apple or Google.</p>
      <nav className="footer-nav" aria-label="Footer">
        <Link to="/download">Download</Link>
        <ExternalLink href={siteConfig.repository}>GitHub</ExternalLink>
        <ExternalLink href={siteConfig.repository + '/blob/main/LICENSE'}>MIT license</ExternalLink>
      </nav>
    </div>
  </footer>;
}
