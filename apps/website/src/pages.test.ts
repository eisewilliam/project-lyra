import { describe, expect, it } from 'vitest';
import { pages, structuredData } from './pages.ts';

describe('pages', () => {
  const all = Object.values(pages);

  it('gives every page its own address, title and description', () => {
    for (const key of ['path', 'title', 'description'] as const) {
      expect(new Set(all.map(page => page[key])).size).toBe(all.length);
    }
  });

  it('keeps descriptions short enough for search results', () => {
    for (const { path, description } of all) expect(description.length, path).toBeLessThanOrEqual(160);
  });
});

describe('structuredData', () => {
  it('names the version when there is a stable one', () => {
    expect(structuredData('1.2.3')).toMatchObject({ '@type': 'SoftwareApplication', softwareVersion: '1.2.3', offers: { price: '0' } });
    expect(structuredData('')).not.toHaveProperty('softwareVersion');
  });
});
