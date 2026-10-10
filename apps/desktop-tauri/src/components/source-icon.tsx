import type { CSSProperties } from 'react';
import type { BrandIcon } from '@/utils/brand-icons';
import { MusicNoteIcon } from '@/utils/lyrics-placeholder-icon';

/**
 * Monochrome mark of the service or app playing media, drawn in the
 * surrounding text colour. Unknown players get Lyra's music-note icon.
 * Decorative; the parent names the source.
 */
export function SourceIcon({
  brand,
  size = 16,
}: Readonly<{
  brand: BrandIcon | null;
  size?: number;
}>) {
  const style = { '--source-icon-size': `${size}px` } as CSSProperties;
  if (!brand) return <MusicNoteIcon className="source-icon" style={style} />;
  return (
    <svg className="source-icon" style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={brand.path} />
    </svg>
  );
}
