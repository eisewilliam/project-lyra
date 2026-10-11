import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist/wght-italic.css';
import { ErrorPage } from './errors/ErrorPage.tsx';
import { routeTree } from './routeTree.gen.ts';
import { visitorPlatform } from './site-config.ts';
import './styles.css';

const router = createRouter({
  routeTree,
  context: { platform: visitorPlatform() },
  defaultPreload: 'intent',
  // Each page's errors render inside the site frame, header and footer intact.
  defaultErrorComponent: ErrorPage,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// After moving to another page, focus its heading so assistive technology
// announces it. In-page hash links keep focus where it is.
router.subscribe('onRendered', ({ fromLocation, pathChanged }) => {
  if (fromLocation && pathChanged) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
});

// index.html carries a static title for link previews and visitors without
// JavaScript. From here on each route's `head` sets it through HeadContent.
document.head.querySelector('title')?.remove();

const root = document.getElementById('root');
if (!root) throw new Error('Lyra website: missing #root element');
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
