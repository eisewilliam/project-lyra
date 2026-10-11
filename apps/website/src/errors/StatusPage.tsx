import type { ReactNode } from 'react';
import { StaffLines, type StaffLyric } from '../components/StaffLines.tsx';

interface StatusPageProps {
  id: string;
  title: string;
  lead: string;
  lyrics: StaffLyric[];
  children: ReactNode;
}

// Shared frame for the not-found and error pages, in the downloads page's style.
// Neither page should be indexed: the host answers every address with the app.
export function StatusPage({ id, title, lead, lyrics, children }: StatusPageProps) {
  return <main id="main-content" className="download-page status-page">
    <meta name="robots" content="noindex" />
    <section className="download-intro" aria-labelledby={id + '-title'}>
      <StaffLines id={id + '-staff'} className="download-staff" lyrics={lyrics} />
      <h1 id={id + '-title'} tabIndex={-1}>{title}</h1>
      <p className="lead">{lead}</p>
      <div className="hero-actions">{children}</div>
    </section>
  </main>;
}
