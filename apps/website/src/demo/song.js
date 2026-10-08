// Original demo song written for this page. Timings mimic a synced LRC file:
// each line starts at `time`, and words are spread across most of the line.
const LINES = [
  [0.0, 'Let the quiet fill the room'],
  [3.6, 'Leave the windows open wide'],
  [7.2, 'Carry a little light with you'],
  [10.8, 'Keep a little song inside'],
  [14.4, 'When the city settles down'],
  [18.0, 'And the day begins to fade'],
  [21.6, 'Hum it back to me slowly'],
  [25.2, 'Every word a lantern'],
  [28.8, 'We keep a light between us'],
  [32.4, 'And still the melody stays'],
];

export const DURATION = 36;

function timeWords(text, start, end) {
  const words = text.split(' ');
  const sung = (end - start) * 0.82;
  const weights = words.map(word => word.length + 1.5);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;
  return words.map((word, index) => {
    const duration = (sung * weights[index]) / total;
    const timed = { text: word, start: cursor, duration };
    cursor += duration;
    return timed;
  });
}

export const demoSong = {
  title: 'Carry a Little Light',
  artist: 'Lyra demo',
  lines: LINES.map(([time, text], index) => {
    const end = index + 1 < LINES.length ? LINES[index + 1][0] : DURATION;
    return { time, end, text, words: timeWords(text, time, end) };
  }),
};

export function lineIndexAt(time) {
  let index = 0;
  demoSong.lines.forEach((line, i) => { if (line.time <= time) index = i; });
  return index;
}
