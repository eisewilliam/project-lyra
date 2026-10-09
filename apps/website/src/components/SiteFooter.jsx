import { siteConfig } from '../site-config.js';
import { ExternalLink, Link } from './router.jsx';

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-inner">
      <img src="/assets/lyra-logo.svg" width="76" height="36" alt="Lyra" />
      <p className="footer-note">A free, open-source lyrics companion. Not affiliated with Spotify.</p>
      <nav className="footer-nav" aria-label="Footer">
        <Link to="/download">Download</Link>
        <ExternalLink href={siteConfig.repository}>GitHub</ExternalLink>
        <ExternalLink href={siteConfig.repository + '/blob/main/LICENSE'}>MIT license</ExternalLink>
      </nav>
    </div>
  </footer>;
}
