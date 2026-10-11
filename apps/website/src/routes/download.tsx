import { createFileRoute } from '@tanstack/react-router';
import { DownloadPage } from '../download/DownloadPage.tsx';
import { isPlatform, type Platform } from '../site-config.ts';

// `?platform=` preselects a platform, e.g. from a platform's Download Lyra button.
export interface DownloadSearch {
  platform?: Platform | undefined;
}

export const Route = createFileRoute('/download')({
  // Validated params are merged over the raw query, so every key is returned,
  // even when invalid, to keep a bad value from reaching the page.
  validateSearch: (search: Record<string, unknown>): DownloadSearch => ({
    platform: isPlatform(search.platform) ? search.platform : undefined,
  }),
  head: () => ({ meta: [{ title: 'Download Lyra' }] }),
  component: DownloadPage,
});
