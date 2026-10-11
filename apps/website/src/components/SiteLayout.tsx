import { HeadContent, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// The frame around every page. HeadContent writes each route's title.
export function SiteLayout() {
  // Motion follows the visitor's reduced-motion setting: transforms are skipped.
  return <MotionConfig reducedMotion="user">
    <HeadContent />
    <div className="site">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <SiteHeader />
      <Outlet />
      <SiteFooter />
    </div>
  </MotionConfig>;
}
