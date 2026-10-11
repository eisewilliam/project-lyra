import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { StatusPage } from './StatusPage.tsx';

export function ErrorPage({ reset }: ErrorComponentProps) {
  return <StatusPage id="error" title="Something slipped."
    lead="This page hit an error while loading. Try again, or start from the top."
    lyrics={[[1, 'rest, then the downbeat', '14%'], [3, 'once more from the top', '52%']]}>
    <button type="button" className="button button-primary button-large" onClick={reset}>Try again</button>
    <Link className="text-link" to="/">Back to Lyra</Link>
  </StatusPage>;
}
