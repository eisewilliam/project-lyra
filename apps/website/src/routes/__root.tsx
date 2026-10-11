import { createRootRouteWithContext } from '@tanstack/react-router';
import { SiteLayout } from '../components/SiteLayout.tsx';
import { NotFoundPage } from '../errors/NotFoundPage.tsx';
import type { Platform } from '../site-config.ts';

export interface RouterContext {
  // The visitor's desktop platform, detected once per visit; null on phones,
  // tablets and anything else Lyra does not run on.
  platform: Platform | null;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: 'Lyra — Keep the song in sight' }] }),
  component: SiteLayout,
  notFoundComponent: NotFoundPage,
});
