import type { ReactNode } from 'react';
import { HeadContent, Scripts } from '@tanstack/react-router';

// Without JavaScript nothing plays the entrance animations, so show where they end.
const noScriptStyles = '<style>.hero-line, .hero-lead, .hero-actions, .platform-row, .credits, .credits > div, .measure-number, .measure-staff { opacity: 1 !important; transform: none !important; }</style>';

// The HTML document around every page, as TanStack Start's root route renders
// it: route head tags in <head>, the app's scripts at the end of <body>.
export function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en">
    <head>
      <HeadContent />
      <noscript dangerouslySetInnerHTML={{ __html: noScriptStyles }} />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>;
}
