import { createRootRoute } from '@tanstack/react-router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist/wght-italic.css';
import '../styles.css';
import { RootDocument } from '../components/RootDocument.tsx';
import { SiteLayout } from '../components/SiteLayout.tsx';
import { NotFoundPage } from '../errors/NotFoundPage.tsx';
import { notFoundPage, shareImage } from '../pages.ts';
import { siteConfig } from '../site-config.ts';

const shareImageAlt = 'Lyra: Keep the song in sight. A treble clef and notes in glass on a staff, with song lyrics showing through them.';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#000000' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Lyra' },
      { property: 'og:locale', content: 'en_GB' },
      { property: 'og:image', content: siteConfig.origin + shareImage },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: shareImageAlt },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image:alt', content: shareImageAlt },
      // Every page sets its own title and description (see pageHead); only
      // an unknown address, and the SPA shell, keep these.
      { title: notFoundPage.title },
      { name: 'description', content: notFoundPage.description },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  component: () => <RootDocument><SiteLayout /></RootDocument>,
  notFoundComponent: NotFoundPage,
});
