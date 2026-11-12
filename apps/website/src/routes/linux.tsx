import { createFileRoute } from '@tanstack/react-router';
import { pageHead, pages } from '../pages.ts';
import { PlatformPage } from '../platform/PlatformPage.tsx';

export const Route = createFileRoute('/linux')({
  head: () => pageHead(pages.linux),
  component: () => <PlatformPage platform="linux" />,
});
