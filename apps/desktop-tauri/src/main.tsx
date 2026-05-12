import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './views/app'
import Island from './views/island'
import Karaoke from './views/karaoke'
import Settings from './views/settings'

const path = window.location.pathname;
const surface =
  path === '/island' ? 'island' :
  path === '/karaoke' ? 'karaoke' :
  path === '/settings' ? 'settings' :
  'main';

const view =
  surface === 'island' ? <Island /> :
  surface === 'karaoke' ? <Karaoke /> :
  surface === 'settings' ? <Settings /> :
  <App />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view}</StrictMode>,
)
