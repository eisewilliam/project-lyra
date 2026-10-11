import { Link } from '@tanstack/react-router';
import { DownloadSimple } from '@phosphor-icons/react';
import { OsIcon } from './OsIcons.tsx';
import { platformNames, siteConfig, type Platform } from '../site-config.ts';

interface DownloadButtonProps {
  platform: Platform | null;
  size?: 'large' | 'medium' | 'small';
  className?: string;
}

// One icon only: the detected platform when known, otherwise a download glyph.
// Without a published file the button opens the downloads page instead.
export function DownloadButton({ platform, size = 'large', className = '' }: DownloadButtonProps) {
  const url = platform && siteConfig.downloads[platform];
  const label = platform ? 'Download Lyra for ' + platformNames[platform] : undefined;
  const classes = `button button-primary button-${size} ${className}`;
  const icon = platform ? <OsIcon platform={platform} className="button-icon" /> : <DownloadSimple className="button-icon" aria-hidden="true" />;
  if (url) return <a className={classes} href={url} aria-label={label}>{icon}<span>Download Lyra</span></a>;
  return <Link className={classes} to="/download" search={platform ? { platform } : {}} aria-label={label}>
    {icon}<span>Download Lyra</span>
  </Link>;
}
