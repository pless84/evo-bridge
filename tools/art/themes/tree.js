// "Tree": a Christmas tree. Its lights take the colour of the state: mixed
// and twinkling when idle, blue while working, orange when it needs you, red
// on an error. When done, every light is on in gold and white.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  g: '1f9a3a', // needles
  d: '0f5a22', // a light that is off
};

// Row widths from row 6 down to 14: three tiers. Star on row 5, trunk on 15.
const WIDTHS = [2, 4, 6, 4, 8, 10, 8, 12, 14];
// Two sets of lights that take turns.
const LIGHTS = [
  [[8, 7], [6, 8], [9, 10], [5, 11], [10, 12], [4, 13], [7, 13], [11, 14]],
  [[9, 8], [6, 10], [8, 11], [11, 11], [6, 12], [9, 13], [3, 14], [7, 14]],
];

// lit: which sets are on (0, 1 or 'both'); colors: cycled over the lights.
function tree({ dx = 0, lit = 'both', colors = ['Y'], star = 'Y' } = {}) {
  const g = k.blank();
  k.stamp(g, ['xx'], 7 + dx, 5, { x: star });
  WIDTHS.forEach((w, i) => {
    for (let x = 8 - w / 2; x < 8 + w / 2; x++) k.put(g, x + dx, 6 + i, 'g');
  });
  k.stamp(g, ['SS'], 7 + dx, 15);
  LIGHTS.forEach((set, n) => set.forEach(([x, y], i) => {
    k.put(g, x + dx, y, lit === 'both' || lit === n ? colors[(i + n) % colors.length] : 'd');
  }));
  return g;
}

const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(draw(tree({ lit: i % 2, colors: ['U'] })), ms));

const STATES = {
  // Mixed lights, twinkling slowly.
  idle: () => [0, 1].map((lit) => k.frame(tree({ lit, colors: ['R', 'Y', 'U', 'P'] }), 800)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(tree({ lit: lit % 2, colors: ['V'] }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Every light flashing orange.
  needs_input: () => [0, 1].map((f) => k.frame(
    k.question(tree(f ? { lit: 'none', star: 'G' } : { colors: ['O'] }), 6, 0, 'O'), 420)),
  // Every light on, gold and white swapping places, the star shining.
  done: () => [0, 1].map((f) => {
    const g = k.check(tree({ colors: f ? ['W', 'Y'] : ['Y', 'W'], star: f ? 'W' : 'Y' }), 5, 0, 'A');
    return k.frame(k.sparkle(g, f ? 12 : 1, 2), 550);
  }),
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => k.frame(
    k.bang(tree({ dx, colors: ['R'], star: 'G' }), 7 + dx, 0, 'R'), i === 4 ? 900 : 90)),
};

module.exports = {
  label: 'Christmas tree',
  description: 'A Christmas tree whose lights show the state: blue while working, orange when it needs you, all lit when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
