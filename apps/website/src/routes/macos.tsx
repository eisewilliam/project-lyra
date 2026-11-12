import { createFileRoute } from '@tanstack/react-router';
import { pageHead, pages } from '../pages.ts';
import { PlatformPage } from '../platform/PlatformPage.tsx';

export const Route = createFileRoute('/macos')({
  head: () => pageHead(pages.macos),
  component: () => <PlatformPage platform="macos" />,
});
