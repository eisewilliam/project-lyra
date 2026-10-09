import { useEffect, useState } from 'react';
import { GithubLogo } from '@phosphor-icons/react';
import { siteConfig } from '../site-config.js';
import { ExternalLink, Link } from './router.jsx';

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
      <Link className="logo-link" to="/" aria-label="Lyra home"><img src="/assets/lyra-logo.svg" alt="" width="92" height="44" /></Link>
      <nav className="header-nav" aria-label="Main">
        <Link className="nav-link" to="/#surfaces">Surfaces</Link>
        <Link className="nav-link" to="/#privacy">Privacy</Link>
        <Link className="nav-link" to="/#faq">FAQ</Link>
        <Link className="nav-link" to="/download">Download</Link>
        <ExternalLink className="button button-quiet button-small" href={siteConfig.repository}>
          <GithubLogo className="button-icon" aria-hidden="true" /><span>Star on GitHub</span>
        </ExternalLink>
      </nav>
    </div>
  </header>;
}
