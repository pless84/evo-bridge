// "Critter": a small loaf-shaped creature with pointy ears. It naps when
// idle, types while working, stares when it needs you.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  b: 'e0904a', // fur
  d: 'a85a22', // dark fur (stripes, tail)
  l: 'ffc890', // light fur (feet, belly)
  n: 'ff8fb0', // nose
};

// Body rows 5..15; the top band (rows 0..4) is free for indicators.
const BODY = [
  ' b         b ',
  ' bb       bb ',
  ' bbbbbbbbbbb ',
  ' bbbbbbbbbbb ',
  ' bbbbbbbbbbb ',
  ' bbbbbnbbbbb ',
  'bbbbbbbbbbbbb',
  'bbbbbbbbbbbbb',
  'bbbbblllbbbbb',
  'bbbbblllbbbbb',
  ' ll  ll  ll  ',
];
const BX = 1;
const BY = 5;

// tail: 0 down, 1 up
function body({ dx = 0, tail = 0, ears = 0, stripes = true } = {}) {
  const g = k.blank();
  k.stamp(g, BODY, BX + dx, BY);
  if (stripes) {
    k.stamp(g, ['d', 'd'], 3 + dx, 8);
    k.stamp(g, ['d', 'd'], 11 + dx, 8);
  }
  if (ears) {                           // perked ears
    k.put(g, 2 + dx, 4, 'b');
    k.put(g, 12 + dx, 4, 'b');
  }
  if (tail) k.stamp(g, ['d', 'd', 'd'], 14 + dx, 9);
  else k.stamp(g, ['  ', 'd ', 'dd'], 14 + dx, 12);
  return g;
}

// Eyes at x 4-5 and 9-10, rows 8-9.
function eyes(g, kind = 'open', dx = 0, look = 0) {
  const L = 4 + dx;
  const R = 9 + dx;
  if (kind === 'closed') {
    k.stamp(g, ['dd'], L, 9);
    k.stamp(g, ['dd'], R, 9);
  } else if (kind === 'happy') {
    k.stamp(g, [' d', 'd '], L, 8);
    k.stamp(g, ['d ', ' d'], R, 8);
  } else if (kind === 'big') {
    // wide open, looking up at you
    k.stamp(g, ['WW', 'WW', 'WW'], L, 7);
    k.stamp(g, ['WW', 'WW', 'WW'], R, 7);
    k.stamp(g, ['K', 'K'], L + 1, 7);
    k.stamp(g, ['K', 'K'], R, 7);
  } else if (kind === 'x') {
    k.stamp(g, ['K K', ' K ', 'K K'], L - 1, 7);
    k.stamp(g, ['K K', ' K ', 'K K'], R, 7);
  } else {
    const p = look < 0 ? 0 : 1;
    k.stamp(g, ['WW', 'WW'], L, 8);
    k.stamp(g, ['WW', 'WW'], R, 8);
    k.put(g, L + p, look === 'up' ? 8 : 9, 'K');
    k.put(g, R + p, look === 'up' ? 8 : 9, 'K');
  }
  return g;
}

const critter = (opts = {}, eyeKind = 'open', look = 0) => eyes(body(opts), eyeKind, opts.dx || 0, look);

// Working: eyes down at its paws, with the shared top-band indicator.
const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => {
  const g = critter({ tail: i % 2 }, 'open', 1);
  // paws tapping
  k.put(g, i % 2 ? 3 : 6, 15, 'W');
  return k.frame(draw(g), ms);
});

const STATES = {
  // Napping, with a z drifting up.
  idle: () => [[9, 1, 'H'], [11, 0, 'W']].map(([x, y, c]) => {
    const g = critter({ tail: 0 }, 'closed');
    k.stamp(g, ['xxxx', '  x ', ' x  ', 'xxxx'], x, y, { x: c });
    return k.frame(g, 1400);
  }),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(critter({ tail: lit % 2 }, 'open', 'up'), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Ears up, big eyes, a question mark bobbing.
  needs_input: () => [0, 1].map((y) => k.frame(k.question(critter({ ears: 1, tail: 1 }, 'big'), 6, y, 'O'), 420)),
  done: () => [0, 1].map((f) => {
    const g = k.check(critter({ tail: f }, 'happy'), 5, 0, 'A');
    return k.frame(f ? k.sparkle(g, 12, 1) : k.sparkle(g, 0, 1), 550);
  }),
  // Startled: fur up, x eyes, shaking.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => {
    const g = critter({ dx, ears: 1, tail: 1, stripes: false }, 'x');
    for (let x = 4; x <= 10; x += 2) k.put(g, x + dx, 4, 'b'); // fur standing up
    return k.frame(k.bang(g, 7 + dx, 0, 'R'), i === 4 ? 900 : 90);
  }),
};

module.exports = {
  label: 'Critter',
  description: 'A small loaf creature: naps when idle, types while working, stares when it needs you.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
