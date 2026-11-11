// "Owl": a round owl on a branch. It sleeps through the day when idle,
// watches its talons while working, stares wide-eyed when it needs you,
// and flaps its wings when done.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  b: 'a0683a', // feathers
  d: '5e3a1e', // dark feathers (tufts, wings)
  l: 'e6cc9c', // light chest
  f: 'f2e2c0', // facial disc
  e: 'ffc21a', // eyes
  k: 'ff9a1a', // beak and talons
  s: '6e4a2a', // branch
  g: '4caf50', // leaf
};

// Body rows 5..15; the top band (rows 0..4) is free for indicators.
// The facial discs (x 3-6 and 9-12, rows 7-10) are drawn by eyes().
const BODY = [
  '   d        d   ',
  '   dbbbbbbbbd   ',
  '  bffffbbffffb  ',
  '  bffffbbffffb  ',
  '  bffffkkffffb  ',
  '  bffffkkffffb  ',
  '  dbbbbbbbbbbd  ',
  '  dblblbblblbd  ',
  '  ddbllllllbdd  ',
  '   ddbbbbbbdd   ',
];

// Each eye is a 4x4 disc; a row of 4 keys per line.
const EYE = {
  open: ['feef', 'eKKe', 'eKKe', 'feef'],
  down: ['feef', 'eeee', 'eKKe', 'feef'],
  up: ['feef', 'eKKe', 'eeee', 'feef'],
  big: ['eeee', 'eeee', 'eKKe', 'eeee'],
  closed: ['ffff', 'ffff', 'dddd', 'ffff'],
  happy: ['ffff', 'fddf', 'dffd', 'ffff'],
  x: ['KffK', 'fKKf', 'fKKf', 'KffK'],
};

// wings: 0 folded, 1 half open, 2 raised. tufts: perked up a pixel.
function owl({ dx = 0, eyes = 'open', right = eyes, wings = 0, tufts = 0, ruffled = false } = {}) {
  const g = k.blank();
  k.stamp(g, ['ssssssssssssssss'], 0, 15);
  k.stamp(g, ['gg'], 14, 14);
  k.stamp(g, BODY, dx, 5);
  k.stamp(g, ['k k'], 5 + dx, 15); // talons
  k.stamp(g, ['k k'], 8 + dx, 15);
  k.stamp(g, EYE[eyes], 3 + dx, 7);
  k.stamp(g, EYE[right], 9 + dx, 7);
  if (tufts) {
    k.put(g, 3 + dx, 4, 'd');
    k.put(g, 12 + dx, 4, 'd');
  }
  if (wings === 1) {
    k.stamp(g, ['d', 'd', 'd'], 1 + dx, 11);
    k.stamp(g, ['d', 'd', 'd'], 14 + dx, 11);
  } else if (wings === 2) {
    k.stamp(g, ['d', 'd', 'd', 'd'], 1 + dx, 8);
    k.stamp(g, ['d', 'd', 'd', 'd'], 14 + dx, 8);
    k.stamp(g, ['d'], 0 + dx, 7);
    k.stamp(g, ['d'], 15 + dx, 7);
  }
  if (ruffled) for (let x = 4; x <= 11; x += 2) k.put(g, x + dx, 5, 'b');
  return g;
}

// Working: eyes on its talons, wings twitching, with the shared indicator.
const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(draw(owl({ eyes: 'down', wings: i % 2 })), ms));

const STATES = {
  // Asleep on its branch (owls nap by day), a z drifting up.
  idle: () => [[9, 1, 'H'], [11, 0, 'W']].map(([x, y, c]) => {
    const g = owl({ eyes: 'closed' });
    k.stamp(g, ['xxxx', '  x ', ' x  ', 'xxxx'], x, y, { x: c });
    return k.frame(g, 1400);
  }),
  // Looking up, one eye squinting, while the dots cycle.
  thinking: () => [0, 1, 2].map((lit) => k.frame(
    k.dots(owl({ eyes: 'up', right: lit === 1 ? 'closed' : 'up' }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Tufts up, huge eyes, a question mark bobbing.
  needs_input: () => [0, 1].map((y) => k.frame(k.question(owl({ eyes: 'big', tufts: 1 }), 6, y, 'O'), 420)),
  // Happy eyes and flapping wings.
  done: () => [0, 1].map((f) => {
    const g = k.check(owl({ eyes: 'happy', wings: f ? 2 : 1 }), 5, 0, 'A');
    return k.frame(f ? k.sparkle(g, 12, 1) : k.sparkle(g, 0, 1), 550);
  }),
  // Startled: feathers ruffled, x eyes, shaking.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => {
    const g = owl({ dx, eyes: 'x', tufts: 1, wings: 1, ruffled: true });
    return k.frame(k.bang(g, 7 + dx, 0, 'R'), i === 4 ? 900 : 90);
  }),
};

module.exports = {
  label: 'Owl',
  description: 'An owl on a branch: sleeps when idle, watches its talons while working, stares wide-eyed when it needs you.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
