import type { ComponentProps } from 'react';

// Links that leave the site open in a new tab; in-site links use the router's Link.
export function ExternalLink({ href, children, ...props }: ComponentProps<'a'> & { href: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
}
