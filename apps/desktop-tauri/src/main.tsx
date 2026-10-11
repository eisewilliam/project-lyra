import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installNativeFeel } from '@/utils/native-feel'
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

installNativeFeel();

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{view}</StrictMode>,
  );
}

// The IPC mock only serves `pnpm dev` previews in a plain browser. Loading it
// dynamically keeps it out of the production bundle every window parses.
const isTauri = '__TAURI_INTERNALS__' in globalThis;
if (import.meta.env.DEV && !isTauri) {
  import('@/utils/browser-mock').then(mount, mount);
} else {
  mount();
}
