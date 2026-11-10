// "Santa": a Santa face. The pompom on his hat swings, and his mouth and
// eyes show the mood.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  w: 'f4f4f4', // fur and beard
  f: 'ffc9a0', // skin
  m: 'a01020', // mouth
};

// Rows 5..15; the top band (rows 0..4) is free for indicators.
const FACE = [
  '     RRRR   ',
  '   RRRRRR   ',
  '  RRRRRRRR  ',
  ' wwwwwwwwww ',
  '  ffffffff  ',
  '  ffffffff  ',
  ' wfffPPfffw ',
  ' wwwwwwwwww ',
  ' wwwwwwwwww ',
  '  wwwwwwww  ',
  '   wwwwww   ',
];
const X = 2;
const Y = 5;

// pom: 0 = pompom up beside the hat's tip, 1 = swung down.
// mouth: 'shut', 'open' or 'smile'.
function santa({ dx = 0, pom = 0, eyes = 'open', mouth = 'shut' } = {}) {
  const g = k.blank();
  k.stamp(g, FACE, X + dx, Y);
  if (pom) {
    k.put(g, X + 9 + dx, Y + 1, 'R');
    k.stamp(g, ['ww', 'ww'], X + 10 + dx, Y + 1);
  } else {
    k.stamp(g, ['ww', 'ww'], X + 9 + dx, Y);
  }
  k.eyes(g, eyes, X + 3 + dx, X + 7 + dx, Y + 4);
  if (mouth === 'open') k.stamp(g, ['KK', 'KK'], X + 5 + dx, Y + 8);
  else if (mouth === 'smile') k.stamp(g, ['m  m', ' mm '], X + 4 + dx, Y + 8);
  else k.stamp(g, ['mm'], X + 5 + dx, Y + 8);
  return g;
}

const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(draw(santa({ pom: i % 2 })), ms));

const STATES = {
  // Blinking, the pompom swinging slowly.
  idle: () => [[0, 'open', 1500], [0, 'closed', 160], [1, 'open', 1500], [1, 'closed', 160]]
    .map(([pom, eyes, ms]) => k.frame(santa({ pom, eyes }), ms)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(santa({ pom: lit % 2, eyes: 'up' }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Calling out to you.
  needs_input: () => [0, 1].map((f) => k.frame(k.question(santa({ pom: f, mouth: f ? 'shut' : 'open' }), 6, 0, 'O'), 420)),
  // Ho ho ho.
  done: () => [0, 1].map((f) => {
    const g = k.check(santa({ pom: f, eyes: 'happy', mouth: 'smile' }), 5, 0, 'A');
    return k.frame(k.sparkle(g, f ? 13 : 0, 1), 550);
  }),
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => k.frame(
    k.bang(santa({ dx, pom: 1, eyes: 'upset', mouth: 'open' }), 7 + dx, 0, 'R'), i === 4 ? 900 : 90)),
};

module.exports = {
  label: 'Santa',
  description: 'Santa\'s face: the pompom swings, he calls out when he needs you and smiles when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
