import { createFileRoute } from '@tanstack/react-router';
import { pageHead, pages } from '../pages.ts';
import { PlatformPage } from '../platform/PlatformPage.tsx';

export const Route = createFileRoute('/windows')({
  head: () => pageHead(pages.windows),
  component: () => <PlatformPage platform="windows" />,
});
