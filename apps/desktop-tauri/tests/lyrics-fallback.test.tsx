import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MainLyricsPane } from '../src/views/app/components/main-lyrics-pane';
import { PanelPlaceholder } from '../src/views/island/components/placeholder';
import { KaraokePlaceholder } from '../src/views/karaoke/components/placeholder';
import { resolveLyricsSurfaceState } from '../src/utils/lyrics-state';
import { shouldShowTrackIntro } from '../src/utils/lyric-renderer';

const ref = () => ({ current: null });
describe('unsynchronized lyrics', () => {
  test('main displays untimed text without seek buttons or word highlights', () => {
    const html = renderToStaticMarkup(<MainLyricsPane activeLine={null} activeLineWords={[]}
      karaokeMode={true} lyrics={[]} plainLyrics={'First line\n\nFinal line'}
      lyricsContainerRef={ref()} lyricsPaneRef={ref()} lyricsRef={{ current: [] }}
      lyricsViewState="unsynced" notFoundReason={null} paintRange={null}
      screenEdgeMotion={{}} seekToLine={() => { throw new Error('Must not seek'); }} wordRefs={{ current: [] }}
      isBrowsing={false} onReturnToCurrent={() => undefined} switching={false} onLineMenu={() => undefined} />);
    expect(html).toContain('Unsynchronized lyrics');
    expect(html).toContain('First line\n\nFinal line');
    expect(html).toContain('is-unsynced');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('lyric-word');
  });
  test('overlays show an explicit no-sync message and never track intro', () => {
    expect(renderToStaticMarkup(<PanelPlaceholder state="unsynced" />)).toContain('No synced lyrics');
    expect(renderToStaticMarkup(<KaraokePlaceholder state="unsynced" lines={2} />)).toContain('No synced lyrics');
    expect(shouldShowTrackIntro({ snapshotReady: true, hasTrack: true, hasActiveLyric: false,
      trackTitle: 'Song', lyricsStatus: 'Unsynced' })).toBe(false);
  });
  test('plain, miss and retryable provider failures stay distinct', () => {
    const state = (lyricsStatus: Parameters<typeof resolveLyricsSurfaceState>[0]['lyricsStatus']) =>
      resolveLyricsSurfaceState({ booted: true, hasTrack: true, hasContent: false, lyricsStatus });
    expect(state('Unsynced')).toBe('unsynced');
    expect(state({ NotFound: { reason: 'Miss' } })).toBe('empty');
    expect(state({ NotFound: { reason: 'NetworkError' } })).toBe('error');
    expect(state({ NotFound: { reason: 'RateLimit' } })).toBe('error');
  });
});
