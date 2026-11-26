import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MainLyricsPane } from '../src/views/app/components/main-lyrics-pane';
import { PanelPlaceholder } from '../src/views/marquee/components/placeholder';
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
    expect(html).toContain('Plain lyrics');
    expect(html).toContain('First line\n\nFinal line');
    expect(html).toContain('is-unsynced');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('lyric-word');
  });
  test('overlays show explicit status copy without loading skeletons outside loading states', () => {
    const unsyncedPanel = renderToStaticMarkup(<PanelPlaceholder state="unsynced" />);
    expect(unsyncedPanel).toContain('Plain lyrics only');
    expect(unsyncedPanel).not.toContain('panel-placeholder-lines');

    const errorPanel = renderToStaticMarkup(<PanelPlaceholder state="error" />);
    expect(errorPanel).toContain('Lyrics unavailable');
    expect(errorPanel).not.toContain('panel-placeholder-lines');

    const emptyPanel = renderToStaticMarkup(<PanelPlaceholder state="empty" />);
    expect(emptyPanel).toContain('No synced lyrics');
    expect(emptyPanel).not.toContain('panel-placeholder-lines');

    const consentPanel = renderToStaticMarkup(<PanelPlaceholder state="consent" />);
    expect(consentPanel).toContain('Allow lyrics for browser media in the main window');
    expect(consentPanel).not.toContain('panel-placeholder-lines');

    const loadingPanel = renderToStaticMarkup(<PanelPlaceholder state="loading" />);
    expect(loadingPanel).toContain('panel-placeholder-lines');
    expect(loadingPanel).not.toContain('panel-placeholder-label');

    const unsyncedKaraoke = renderToStaticMarkup(<KaraokePlaceholder state="unsynced" lines={2} />);
    expect(unsyncedKaraoke).toContain('Plain lyrics only');
    expect(unsyncedKaraoke).not.toContain('karaoke-placeholder-dots');

    const errorKaraoke = renderToStaticMarkup(<KaraokePlaceholder state="error" lines={2} />);
    expect(errorKaraoke).toContain('Lyrics unavailable');
    expect(errorKaraoke).not.toContain('karaoke-placeholder-dots');

    const emptyKaraoke = renderToStaticMarkup(<KaraokePlaceholder state="empty" lines={1} />);
    expect(emptyKaraoke).toContain('No synced lyrics');

    const consentKaraoke = renderToStaticMarkup(<KaraokePlaceholder state="consent" lines={2} />);
    expect(consentKaraoke).toContain('Allow lyrics for browser media in the main window');

    const loadingKaraoke = renderToStaticMarkup(<KaraokePlaceholder state="loading" lines={2} />);
    expect(loadingKaraoke).toContain('karaoke-placeholder-dots');
    expect(loadingKaraoke).not.toContain('karaoke-placeholder-label');

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
