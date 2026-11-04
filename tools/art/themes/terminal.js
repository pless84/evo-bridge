// "Terminal": plain text on a dark screen. A blinking cursor when idle,
// a progress bar while working, ? when it needs you, OK and ERR.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  g: '1a6a30', // dim green
  b: '9fd0ff', // light blue
};

// 3x5 glyphs.
const FONT = {
  $: [' xx', 'xx ', ' x ', ' xx', 'xx '],
  '>': ['x  ', ' x ', '  x', ' x ', 'x  '],
  '?': ['xx ', '  x', ' x ', '   ', ' x '],
  O: ['xxx', 'x x', 'x x', 'x x', 'xxx'],
  K: ['x x', 'xx ', 'x  ', 'xx ', 'x x'],
  E: ['xxx', 'x  ', 'xx ', 'x  ', 'xxx'],
  R: ['xx ', 'x x', 'xx ', 'x x', 'x x'],
  '.': ['   ', '   ', '   ', '   ', ' x '],
};

function text(g, str, x, y, c) {
  [...str].forEach((ch, i) => FONT[ch] && k.stamp(g, FONT[ch], x + i * 4, y, { x: c }));
  return g;
}

const cursor = (g, x, y, c) => k.stamp(g, ['xxx'], x, y, { x: c });

// Big 5x7 letters for the result.
const BIG = {
  O: [' xxx ', 'x   x', 'x   x', 'x   x', 'x   x', 'x   x', ' xxx '],
  K: ['x   x', 'x  x ', 'x x  ', 'xx   ', 'x x  ', 'x  x ', 'x   x'],
};

const STATES = {
  idle: () => [true, false].map((on) => {
    const g = text(k.blank(), '$', 1, 9, 'g');
    if (on) cursor(g, 5, 13, 'C');
    return k.frame(g, 600);
  }),
  thinking: () => [0, 1, 2].map((lit) => {
    const g = text(k.blank(), '>', 1, 2, 'g');
    return k.frame(k.dots(g, lit, 9, 'W', 'V'), 350);
  }),
  // A progress bar filling, with the prompt above.
  working: () => [0, 2, 4, 6, 8, 10, 12, 14].map((n, i) => {
    const g = text(k.blank(), '>', 1, 2, 'g');
    k.stamp(g, ['xxxxxxxxxxxxxx'], 1, 10, { x: 'G' });
    k.stamp(g, ['x'.repeat(Math.max(1, n))], 1, 10, { x: 'U' });
    k.put(g, 1 + n, 10, 'W');
    cursor(g, 5, 6, i % 2 ? 'C' : 'g');
    return k.frame(g, 120);
  }),
  working_bash: () => [true, false].map((on) => {
    const g = text(k.blank(), '$>', 1, 5, 'C');
    if (on) cursor(g, 9, 9, 'C');
    return k.frame(g, 450);
  }),
  // Lines being typed out.
  working_edit: () => [2, 5, 8, 11, 14, 14].map((n, i) => {
    const g = k.blank();
    k.stamp(g, ['x'.repeat(14)], 1, 3, { x: 'H' });
    k.stamp(g, ['x'.repeat(9)], 1, 6, { x: 'H' });
    k.stamp(g, ['x'.repeat(n)], 1, 9, { x: 'W' });
    if (n < 15) k.put(g, 1 + n, 9, i % 2 ? 'Y' : 'W');
    return k.frame(g, i === 5 ? 500 : 160);
  }),
  // Text scrolling up, one line highlighted.
  working_read: () => [0, 1, 2, 3].map((f) => {
    const g = k.blank();
    const widths = [12, 8, 14, 6, 10, 13, 7];
    for (let r = 0; r < 5; r++) {
      const w = widths[(r + f) % widths.length];
      k.stamp(g, ['x'.repeat(w)], 1, 1 + r * 3, { x: r === 2 ? 'b' : 'G' });
    }
    return k.frame(g, 380);
  }),
  needs_input: () => [true, false].map((on) => {
    const g = text(k.blank(), '>', 1, 5, 'g');
    text(g, '?', 7, 5, on ? 'O' : 'W');
    if (on) cursor(g, 11, 9, 'O');
    return k.frame(g, 420);
  }),
  done: () => [true, false].map((on) => {
    const g = k.blank();
    k.stamp(g, BIG.O, 2, 3, { x: 'A' });
    k.stamp(g, BIG.K, 9, 3, { x: 'A' });
    if (on) cursor(g, 2, 12, 'W');
    return k.frame(g, 600);
  }),
  error: () => [true, false, true, false].map((on, i) => {
    const g = text(k.blank(), 'ERR', 2, 5, on ? 'R' : 'W');
    return k.frame(g, i === 3 ? 900 : 250);
  }),
};

module.exports = {
  label: 'Terminal',
  description: 'Plain text: a blinking cursor, a progress bar, ? when it needs you, OK and ERR.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
