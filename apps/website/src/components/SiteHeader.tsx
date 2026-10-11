import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { GithubLogo } from '@phosphor-icons/react';
import { siteConfig } from '../site-config.ts';
import { ExternalLink } from './ExternalLink.tsx';

// Section links count as the current page only when their own section was
// the target, not merely because the landing page is open.
const sectionActive = { exact: true, includeHash: true };

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <header className={'site-header' + (scrolled ? ' is-scrolled' : '')}>
    <div className="header-inner">
      <Link className="logo-link" to="/" activeOptions={{ exact: true }} aria-label="Lyra home"><img src="/assets/lyra-logo.svg" alt="" width="92" height="44" /></Link>
      <nav className="header-nav" aria-label="Main">
        <Link className="nav-link" to="/" hash="surfaces" activeOptions={sectionActive}>Surfaces</Link>
        <Link className="nav-link" to="/" hash="privacy" activeOptions={sectionActive}>Privacy</Link>
        <Link className="nav-link" to="/" hash="faq" activeOptions={sectionActive}>FAQ</Link>
        <Link className="nav-link" to="/download">Download</Link>
        <ExternalLink className="button button-quiet button-small" href={siteConfig.repository}>
          <GithubLogo className="button-icon" aria-hidden="true" /><span>Star on GitHub</span>
        </ExternalLink>
      </nav>
    </div>
  </header>;
}
