import { useEffect } from 'react';
import { Outlet, useRouter } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// The frame around every page, inside the root route's document.
export function SiteLayout() {
  const router = useRouter();
  // After moving to another page, focus its heading so assistive technology
  // announces it. In-page hash links keep focus where it is.
  useEffect(() => router.subscribe('onRendered', ({ fromLocation, pathChanged }) => {
    if (fromLocation && pathChanged) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }), [router]);
  // Motion follows the visitor's reduced-motion setting: transforms are skipped.
  return <MotionConfig reducedMotion="user">
    <div className="site">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <SiteHeader />
      <Outlet />
      <SiteFooter />
    </div>
  </MotionConfig>;
}
