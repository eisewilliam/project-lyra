import { useEffect, useState } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist/wght-italic.css';
import { RouterProvider, useRouter } from './components/router.jsx';
import { SiteFooter } from './components/SiteFooter.jsx';
import { SiteHeader } from './components/SiteHeader.jsx';
import { DownloadPage } from './download/DownloadPage.jsx';
import { LandingPage } from './landing/LandingPage.jsx';
import { visitorPlatform } from './site-config.js';

function Routes() {
  const { path } = useRouter();
  const [platform] = useState(visitorPlatform);
  const downloads = /^\/download\/?$/.test(path);
  useEffect(() => {
    document.title = downloads ? 'Download Lyra' : 'Lyra — Keep the song in sight';
  }, [downloads]);
  return <div className={'site' + (downloads ? ' is-download' : ' is-landing')}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <SiteHeader />
    {downloads ? <DownloadPage platform={platform} /> : <LandingPage platform={platform} />}
    <SiteFooter />
  </div>;
}

export function App() {
  return <RouterProvider><Routes /></RouterProvider>;
}
