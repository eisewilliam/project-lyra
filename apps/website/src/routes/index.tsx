import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '../landing/LandingPage.tsx';

// QA hooks: `?frame=<phrase>:<seconds>` renders one still frame of the hero
// light; `?motion=off` starts with the hero paused.
export interface LandingSearch {
  frame?: string | undefined;
  motion?: 'off' | undefined;
}

export const Route = createFileRoute('/')({
  // Most visits start here, so the landing page ships in the entry bundle:
  // splitting it out would make the hero wait for a second request.
  codeSplitGroupings: [],
  // Validated params are merged over the raw query, so every key is returned.
  validateSearch: (search: Record<string, unknown>): LandingSearch => ({
    frame: typeof search.frame === 'string' ? search.frame : undefined,
    motion: search.motion === 'off' ? 'off' : undefined,
  }),
  component: LandingPage,
});
