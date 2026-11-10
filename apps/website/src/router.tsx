import { createRouter } from '@tanstack/react-router';
import { ErrorPage } from './errors/ErrorPage.tsx';
import { routeTree } from './routeTree.gen.ts';

// TanStack Start calls this for each server render and once in the browser.
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    // Each page's errors render inside the site frame, header and footer intact.
    defaultErrorComponent: ErrorPage,
    scrollRestoration: true,
  });
}
