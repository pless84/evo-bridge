// "Status ring": no character, just a coloured ring and one symbol in the
// middle. The easiest to read from across the room.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  t: '0f6e65', // dim teal
  v: '4b38a0', // dim violet
  u: '1d4fa8', // dim blue
  o: 'a8480a', // dim orange
  a: '1e7a32', // dim green
  r: '8a1418', // dim red
};

const RING = k.circle(7.5, 7.5, 6.6);

// Whole ring in one colour.
function ring(color) {
  const g = k.blank();
  RING.forEach(([x, y]) => k.put(g, x, y, color));
  return g;
}

// A bright head orbiting with a short tail.
function orbit(f, bright, mid, dim, step = 2) {
  const g = k.blank();
  const n = RING.length;
  RING.forEach(([x, y], i) => {
    const age = (f * step - i + n * 4) % n;
    k.put(g, x, y, age < 2 ? bright : age < 6 ? mid : dim);
  });
  return g;
}

// Centre symbols (drawn around x 5..10, y 5..10).
const center = (g, sprite, c) => k.stamp(g, sprite, 8 - Math.ceil(sprite[0].length / 2), 8 - Math.ceil(sprite.length / 2), { x: c });
const DOT = ['xx', 'xx'];
const PROMPT = ['x   ', ' x  ', '  x ', ' x  ', 'x xx'];
const PEN = ['   x', '  x ', ' x  ', 'x   '];
const LINES = ['xxxx', '    ', 'xxx ', '    ', 'xxxx'];
const Q = [' xx ', 'x  x', '  x ', '    ', '  x '];
const TICK = ['    x', '   x ', 'x x  ', ' x   '];
const X = ['x   x', ' x x ', '  x  ', ' x x ', 'x   x'];

const n = RING.length;
const STATES = {
  // Slow breathing.
  idle: () => [
    k.frame(ring('T'), 1800),
    k.frame(ring('t'), 900),
  ],
  thinking: () => Array.from({ length: Math.ceil(n / 2) }, (_, f) => {
    const g = orbit(f, 'W', 'V', 'v');
    return k.frame(center(g, DOT, 'V'), 70);
  }),
  working: () => Array.from({ length: Math.ceil(n / 3) }, (_, f) => {
    const g = orbit(f, 'W', 'U', 'u', 3);
    return k.frame(center(g, DOT, 'U'), 60);
  }),
  working_bash: () => [true, false].map((on) => {
    const g = ring('U');
    return k.frame(center(g, on ? PROMPT : PROMPT.map((r, i) => (i === 4 ? r.slice(0, 2) + '  ' : r)), 'C'), 450);
  }),
  working_edit: () => [0, 1, 2, 3].map((f) => {
    const g = orbit(f * 3, 'W', 'U', 'u', 2);
    return k.frame(center(g, PEN, f % 2 ? 'Y' : 'W'), 200);
  }),
  working_read: () => [0, 1, 2].map((f) => {
    const g = ring('U');
    const lines = LINES.map((r, i) => (i === f * 2 ? r : r.replace(/x/g, 'y')));
    k.stamp(g, lines, 6, 5, { x: 'Y', y: 'H' });
    return k.frame(g, 380);
  }),
  // Pulsing: bright, dim.
  needs_input: () => [
    k.frame(center(ring('O'), Q, 'W'), 450),
    k.frame(center(ring('o'), Q, 'O'), 450),
  ],
  done: () => [
    k.frame(center(ring('A'), TICK, 'W'), 1400),
    k.frame(center(ring('A'), TICK, 'A'), 400),
  ],
  error: () => [
    k.frame(center(ring('R'), X, 'W'), 300),
    k.frame(center(ring('r'), X, 'R'), 300),
    k.frame(center(ring('R'), X, 'W'), 300),
    k.frame(center(ring('r'), X, 'R'), 900),
  ],
};

module.exports = {
  label: 'Status ring',
  description: 'A coloured ring with one symbol: readable from across the room.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
