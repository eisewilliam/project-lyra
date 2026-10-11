import { Link } from '@tanstack/react-router';
import { StatusPage } from './StatusPage.tsx';

export function NotFoundPage() {
  return <StatusPage id="not-found" title="Lost the thread."
    lead="There’s nothing at this address. The link may be old, or mistyped."
    lyrics={[[1, 'half a verse from home', '14%'], [3, 'come back to the refrain', '52%']]}>
    <Link className="button button-primary button-large" to="/">Back to Lyra</Link>
    <Link className="text-link" to="/download">Downloads</Link>
  </StatusPage>;
}
