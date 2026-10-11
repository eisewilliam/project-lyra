import type { CSSProperties } from 'react';

// Public-domain songs used as demos. Timings mimic a synced LRC file: each
// line starts at `time`, and words are spread across most of the line.
// Only use lyrics whose copyright has expired (traditional, or published
// long enough ago); never add lyrics from copyrighted recordings or arrangements.
// Each song has its own artwork palette: the surfaces take their colour
// from the music, as Lyra does from album artwork. Brand teal stays Lyra's.

export interface TimedWord {
  text: string;
  start: number;
  duration: number;
}

export interface SongLine {
  time: number;
  end: number;
  text: string;
  words: TimedWord[];
}

export interface Palette {
  deep: string;
  a: string;
  b: string;
  c: string;
}

export type SongId = 'shenandoah' | 'greensleeves' | 'dannyboy';

export interface Song {
  id: SongId;
  title: string;
  artist: string;
  art: 'sun' | 'bloom' | 'night';
  palette: Palette;
  duration: number;
  lines: SongLine[];
}

interface SongSource extends Pick<Song, 'id' | 'title' | 'art' | 'palette'> {
  credit: string;
  step: number;
  lines: string[];
}

function timeWords(text: string, start: number, end: number): TimedWord[] {
  const words = text.split(' ');
  const sung = (end - start) * 0.82;
  const weight = (word: string) => word.length + 1.5;
  const total = words.reduce((sum, word) => sum + weight(word), 0);
  let cursor = start;
  return words.map(word => {
    const duration = (sung * weight(word)) / total;
    const timed = { text: word, start: cursor, duration };
    cursor += duration;
    return timed;
  });
}

function song({ id, title, credit, art, palette, step, lines }: SongSource): Song {
  const duration = lines.length * step;
  return {
    id, title, art, palette, duration,
    artist: credit,
    lines: lines.map((text, index) => {
      const time = index * step;
      return { time, end: time + step, text, words: timeWords(text, time, time + step) };
    }),
  };
}

export const songs: readonly Song[] = [
  song({
    id: 'shenandoah', title: 'Shenandoah', credit: 'Traditional', art: 'sun', step: 3.8,
    palette: { deep: '#1f0d05', a: '#f2a33a', b: '#c8441f', c: '#ffd9a1' },
    lines: [
      'Oh Shenandoah, I long to see you',
      'Away, you rolling river',
      'Oh Shenandoah, I long to see you',
      'Away, I’m bound away',
      'Across the wide Missouri',
      'Oh Shenandoah, I love your daughter',
      'Away, you rolling river',
      'For her I’d cross your roaming waters',
    ],
  }),
  song({
    id: 'greensleeves', title: 'Greensleeves', credit: 'Traditional, 16th century', art: 'bloom', step: 3.6,
    palette: { deep: '#170926', a: '#e0479e', b: '#7140e6', c: '#ffc2e4' },
    lines: [
      'Alas, my love, you do me wrong',
      'To cast me off discourteously',
      'For I have loved you well and long',
      'Delighting in your company',
      'Greensleeves was all my joy',
      'Greensleeves was my delight',
      'Greensleeves was my heart of gold',
      'And who but my lady Greensleeves',
    ],
  }),
  song({
    id: 'dannyboy', title: 'Danny Boy', credit: 'Words by Frederic Weatherly, 1913', art: 'night', step: 4.2,
    palette: { deep: '#050f27', a: '#3a6dff', b: '#1b2f8f', c: '#cfe4ff' },
    lines: [
      'Oh Danny boy, the pipes, the pipes are calling',
      'From glen to glen, and down the mountain side',
      'The summer’s gone, and all the roses falling',
      'It’s you, it’s you must go and I must bide',
      'But come ye back when summer’s in the meadow',
      'Or when the valley’s hushed and white with snow',
      'It’s I’ll be here in sunshine or in shadow',
      'Oh Danny boy, oh Danny boy, I love you so',
    ],
  }),
];

export function songById(id: SongId): Song {
  const found = songs.find(option => option.id === id);
  if (!found) throw new Error('Unknown demo song: ' + id);
  return found;
}

export function lineIndexAt(song: Song, time: number): number {
  let index = 0;
  song.lines.forEach((line, i) => { if (line.time <= time) index = i; });
  return index;
}

// The line at `index`, wrapping past the end so "the next line" loops round.
export function lineAt(song: Song, index: number): SongLine {
  const line = song.lines[index % song.lines.length];
  if (!line) throw new Error('Demo song has no lines: ' + song.id);
  return line;
}

// Palette as CSS custom properties for a scene.
export const paletteStyle = ({ palette }: Pick<Song, 'palette'>): CSSProperties => ({
  '--song-deep': palette.deep, '--song-a': palette.a, '--song-b': palette.b, '--song-c': palette.c,
});
