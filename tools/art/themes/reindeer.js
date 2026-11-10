// "Reindeer": a reindeer face with antlers and a glowing nose. The nose is
// red, flashes orange when it needs you and turns green when done.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  b: 'a8652e', // fur
  l: 'e0b080', // muzzle
  a: 'd8c090', // antlers
  r: '801018', // nose, dimmed
};

// Rows 5..15; the top band (rows 0..4) is free for indicators.
const HEAD = [
  ' a a      a a ',
  ' aaa      aaa ',
  '  a  bbbb  a  ',
  '  abbbbbbbba  ',
  '   bbbbbbbb   ',
  '   bbbbbbbb   ',
  '   bbbbbbbb   ',
  '   bllllllb   ',
  '    ll  ll    ',
  '    ll  ll    ',
  '     llll     ',
];
const X = 1;
const Y = 5;

// ears: 0 = out, 1 = drooping. nose: a palette key.
function reindeer({ dx = 0, ears = 0, eyes = 'open', nose = 'R' } = {}) {
  const g = k.blank();
  k.stamp(g, HEAD, X + dx, Y);
  k.stamp(g, ['bb'], X + 1 + dx, Y + 4 + ears);
  k.stamp(g, ['bb'], X + 11 + dx, Y + 4 + ears);
  k.stamp(g, ['xx', 'xx'], X + 6 + dx, Y + 8, { x: nose });
  return k.eyes(g, eyes, X + 4 + dx, X + 8 + dx, Y + 5);
}

const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(
  draw(reindeer({ ears: i % 2, nose: i % 2 ? 'r' : 'R' })), ms));

const STATES = {
  // The nose glows slowly; a blink now and then.
  idle: () => [['R', 'open', 1200], ['r', 'open', 1200], ['R', 'open', 1200], ['r', 'closed', 160]]
    .map(([nose, eyes, ms]) => k.frame(reindeer({ nose, eyes }), ms)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(reindeer({ eyes: 'up', ears: lit % 2 }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  needs_input: () => [0, 1].map((f) => k.frame(k.question(reindeer({ nose: f ? 'R' : 'O' }), 6, f, 'O'), 420)),
  done: () => [0, 1].map((f) => {
    const g = k.check(reindeer({ eyes: 'happy', nose: 'A', ears: f }), 5, 0, 'A');
    return k.frame(k.sparkle(g, f ? 13 : 0, 0), 550);
  }),
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => k.frame(
    k.bang(reindeer({ dx, ears: 1, eyes: 'upset' }), 7 + dx, 0, 'R'), i === 4 ? 900 : 90)),
};

module.exports = {
  label: 'Reindeer',
  description: 'A reindeer with a glowing red nose: it flashes orange when it needs you and turns green when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
