// "Fox": a sitting fox with a big white-tipped tail. It sleeps when idle,
// wags its tail while working, pricks up its ears when it needs you, and
// wags happily when done.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  o: 'f07a20', // fur
  r: 'b8501a', // shaded fur (tail, flanks)
  w: 'fff1dc', // white (cheeks, chest, tail tip)
  d: '3a2418', // dark (ear tips, paws)
  i: 'ffa898', // inner ear
};

// Head and body, x 0..11, rows 5..15; the tail is drawn by tail().
// The top band (rows 0..4) is free for indicators.
const BODY = [
  ' d         d',
  ' oi       io',
  ' ooooooooooo',
  ' ooooooooooo',
  ' wwoooooooww',
  '  wwwwwwwww ',
  '   wwwwwww  ',
  '  ooowwwooo ',
  '  rrowwwoor ',
  '  rrowwwoor ',
  '  dd     dd ',
];

// The tail curls up on the right, white tip on top. pose: 0 down, 1 up, 2 swept out.
const TAILS = [
  ['            ', '            ', '    ww      ', '   roow     ', '  rroo      ', ' rroo       '],
  ['   ww       ', '  rroo      ', '  rroo      ', '   rro      ', '   rro      ', ' rroo       '],
  ['            ', '      ww    ', '   rrooow   ', '  rroooo    ', ' rroo       ', ' rro        '],
];
function tail(g, pose, dx) {
  k.stamp(g, TAILS[pose], 10 + dx, 9);
}

// Eyes: 2x2 at x 3-4 and 8-9, rows 8-9.
const EYE = {
  open: ['KK', 'KK'],
  down: ['oo', 'KK'],
  up: ['KK', 'oo'],
  big: ['WK', 'KK'],
  closed: ['oo', 'dd'],
  happy: ['dd', 'oo'],
};

function fox({ dx = 0, eyes = 'open', pose = 0, ears = 0 } = {}) {
  const g = k.blank();
  tail(g, pose, dx);
  k.stamp(g, BODY, dx, 5);
  k.put(g, 6 + dx, 10, 'K'); // nose
  if (eyes === 'x') {
    k.stamp(g, ['K K', ' K ', 'K K'], 2 + dx, 7);
    k.stamp(g, ['K K', ' K ', 'K K'], 8 + dx, 7);
  } else if (eyes === 'happy') {
    k.stamp(g, [' d ', 'd d'], 2 + dx, 8);
    k.stamp(g, [' d ', 'd d'], 8 + dx, 8);
  } else {
    k.stamp(g, EYE[eyes], 3 + dx, 8);
    k.stamp(g, EYE[eyes].map((r) => [...r].reverse().join('')), 8 + dx, 8);
  }
  if (ears) { // pricked up
    k.put(g, 1 + dx, 4, 'd');
    k.put(g, 11 + dx, 4, 'd');
    k.put(g, 1 + dx, 5, 'o');
    k.put(g, 11 + dx, 5, 'o');
  }
  return g;
}

// Working: eyes on its paws, tail swishing, with the shared indicator.
const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(draw(fox({ eyes: 'down', pose: i % 2 ? 2 : 0 })), ms));

const STATES = {
  // Asleep, a z drifting up.
  idle: () => [[9, 1, 'H'], [11, 0, 'W']].map(([x, y, c]) => {
    const g = fox({ eyes: 'closed' });
    k.stamp(g, ['xxxx', '  x ', ' x  ', 'xxxx'], x, y, { x: c });
    return k.frame(g, 1400);
  }),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(fox({ eyes: 'up', pose: lit === 1 ? 1 : 0 }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Ears pricked, eyes wide, tail up, a question mark bobbing.
  needs_input: () => [0, 1].map((y) => k.frame(k.question(fox({ eyes: 'big', ears: 1, pose: 1 }), 5, y, 'O'), 420)),
  // Happy eyes and a wagging tail.
  done: () => [0, 1].map((f) => {
    const g = k.check(fox({ eyes: 'happy', pose: f ? 2 : 1 }), 4, 0, 'A');
    return k.frame(f ? k.sparkle(g, 12, 1) : k.sparkle(g, 0, 1), 550);
  }),
  // Startled: ears up, x eyes, shaking.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => {
    const g = fox({ dx, eyes: 'x', ears: 1, pose: 1 });
    return k.frame(k.bang(g, 6 + dx, 0, 'R'), i === 4 ? 900 : 90);
  }),
};

module.exports = {
  label: 'Fox',
  description: 'A sitting fox: sleeps when idle, swishes its tail while working, pricks up its ears when it needs you.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
