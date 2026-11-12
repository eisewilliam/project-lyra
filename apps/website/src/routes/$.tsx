import { createFileRoute } from '@tanstack/react-router';
import { NotFoundPage } from '../errors/NotFoundPage.tsx';

// Every address no page matches. The worker serves these the SPA shell with a
// 404 status (see vite.config.ts). A catch-all route, rather than the root's
// not-found component, keeps hydration in step with the shell: the browser
// renders the page area as pending, as the shell left it, then fills it in.
// The route adds no head tags, so the root's not-found title applies, and the
// page itself asks not to be indexed (see StatusPage).
export const Route = createFileRoute('/$')({
  component: NotFoundPage,
});
