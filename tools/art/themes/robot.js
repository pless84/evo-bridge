// "Robot": a boxy robot head. The antenna light takes the state's colour and
// the screen shows what is going on.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  m: '8a93a6', // metal
  n: '50586a', // dark metal
  s: '0b1a1e', // screen
  e: '5fe8ff', // screen eyes (cyan)
};

// Head x 2..13, rows 2..12; screen x 4..11, rows 4..9; neck and shoulders below.
const HEAD = [
  '      nn      ',
  'mmmmmmmmmmmmmm',
  'mnnnnnnnnnnnnm',
  'mnssssssssssnm',
  'mnssssssssssnm',
  'mnssssssssssnm',
  'mnssssssssssnm',
  'mnssssssssssnm',
  'mnssssssssssnm',
  'mnnnnnnnnnnnnm',
  'mmmmmmmmmmmmmm',
  '    nnnnnn    ',
  '  mmmmmmmmmm  ',
];
const SX = 4; // screen origin
const SY = 5;

// light: the antenna tip colour key (or null for off).
function robot(light, dx = 0) {
  const g = k.blank();
  k.stamp(g, HEAD, 1 + dx, 1);
  k.put(g, 7 + dx, 0, light || 'n');
  k.put(g, 8 + dx, 0, light || 'n');
  return g;
}

// Draw on the screen (8 wide, 6 high); sprite coords are relative to it.
const screen = (g, sprite, x, y, map, dx = 0) => k.stamp(g, sprite, SX + x + dx, SY + y, map);

function eyes(g, { look = 0, blink = false, color = 'e', dx = 0 } = {}) {
  const rows = blink ? ['    ', 'xx  xx'] : ['xx  xx', 'xx  xx'];
  return screen(g, rows, 1 + look, blink ? 1 : 1, { x: color }, dx);
}

const STATES = {
  idle: () => [
    k.frame(eyes(robot('T')), 2400),
    k.frame(eyes(robot('T'), { blink: true }), 160),
    k.frame(eyes(robot(null)), 1200),
    k.frame(eyes(robot('T'), { blink: true }), 160),
  ],
  thinking: () => [0, 1, 2].map((lit) => {
    const g = robot(lit % 2 ? 'V' : null);
    eyes(g, { look: 0 });
    [0, 3, 6].forEach((x, i) => screen(g, ['x'], x + 1, 4, { x: i === lit ? 'W' : 'V' }));
    return k.frame(g, 350);
  }),
  // A progress bar sweeping along the bottom of the screen.
  working: () => [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
    const g = eyes(robot(f % 2 ? 'U' : null));
    for (let x = 0; x < 8; x++) screen(g, ['x'], x, 4, { x: x === f ? 'W' : x < f ? 'U' : 'n' });
    return k.frame(g, 110);
  }),
  working_bash: () => [true, false].map((on) => {
    const g = robot('C');
    screen(g, ['x  ', ' x ', 'x  '], 1, 1, { x: 'C' });
    if (on) screen(g, ['xxx'], 4, 3, { x: 'C' });
    return k.frame(g, 450);
  }),
  // Lines of text being typed.
  working_edit: () => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
    const g = robot('U');
    for (let i = 0; i < n; i++) {
      const row = i < 6 ? 0 : 2;
      const col = i < 6 ? i : i - 6;
      screen(g, ['x'], 1 + col, 1 + row, { x: 'W' });
    }
    screen(g, ['x'], 1 + (n < 6 ? n : n - 6), n < 6 ? 1 : 3, { x: 'Y' }); // cursor
    return k.frame(g, 160);
  }),
  // Text lines scrolling up.
  working_read: () => [0, 1, 2, 3].map((f) => {
    const g = robot('U');
    const lines = ['xxxxxx', 'xxxx  ', 'xxxxx ', 'xxx   '];
    // three text lines with gaps; the middle one is being read
    for (let r = 0; r < 3; r++) screen(g, [lines[(r + f) % lines.length]], 1, r * 2, { x: r === 1 ? 'Y' : 'H' });
    return k.frame(g, 380);
  }),
  needs_input: () => [true, false].map((on) => {
    const g = robot(on ? 'O' : null);
    screen(g, ['  xx ', ' x  x', '   x ', '     ', '   x '], 1, 0, { x: on ? 'O' : 'W' });
    return k.frame(g, 420);
  }),
  done: () => [0, 1].map((f) => {
    const g = robot('A');
    screen(g, ['     x', '    x ', ' x x  ', '  x   '], 1, 1, { x: 'A' });
    if (f) k.sparkle(g, 12, 0);
    else k.sparkle(g, 0, 0);
    return k.frame(g, 550);
  }),
  // Red screen, a cross, and a shake.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => {
    const g = k.replace(robot('R', dx), 's', i % 2 ? 's' : 'K');
    screen(g, ['x   x', ' x x ', '  x  ', ' x x ', 'x   x'], 1, 0, { x: 'R' }, dx);
    return k.frame(g, i === 4 ? 900 : 90);
  }),
};

module.exports = {
  label: 'Robot',
  description: 'A robot head: the antenna light shows the state, the screen shows the work.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([n, f]) => [n, { frames: f() }])),
  paletteFor: () => PALETTE,
};
