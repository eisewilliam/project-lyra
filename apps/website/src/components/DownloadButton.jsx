import { DownloadSimple } from '@phosphor-icons/react';
import { OsIcon } from './OsIcons.jsx';
import { platformNames, siteConfig } from '../site-config.js';
import { Link } from './router.jsx';

export function PlatformIcon({ platform, ...props }) {
  return <OsIcon platform={platform} {...props} />;
}

// One icon only: the detected platform when known, otherwise a download glyph.
// Without a published file the button opens the downloads page instead.
export function DownloadButton({ platform, size = 'large', className = '' }) {
  const url = platform && siteConfig.downloads[platform];
  const label = platform ? 'Download Lyra for ' + platformNames[platform] : undefined;
  const classes = `button button-primary button-${size} ${className}`;
  const icon = platform ? <PlatformIcon platform={platform} className="button-icon" /> : <DownloadSimple className="button-icon" aria-hidden="true" />;
  if (url) return <a className={classes} href={url} aria-label={label}>{icon}<span>Download Lyra</span></a>;
  return <Link className={classes} to={platform ? '/download?platform=' + platform : '/download'} aria-label={label}>
    {icon}<span>Download Lyra</span>
  </Link>;
}
