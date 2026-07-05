import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './views/app'
import Island from './views/island'
import Karaoke from './views/karaoke'
import Settings from './views/settings'

const path = globalThis.location.pathname;

let surface = 'main';
if (path === '/island') {
  surface = 'island';
} else if (path === '/karaoke') {
  surface = 'karaoke';
} else if (path === '/settings') {
  surface = 'settings';
}

let view = <App />;
if (surface === 'island') {
  view = <Island />;
} else if (surface === 'karaoke') {
  view = <Karaoke />;
} else if (surface === 'settings') {
  view = <Settings />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view}</StrictMode>,
)
