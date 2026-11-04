// "Sprout": a potted plant. It sways when idle, grows while working, droops
// when it needs you and blooms when done.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  g: '3ccf5a', // stem and leaves
  l: '9cf0a8', // light leaf
  y: '8a7a2a', // dry leaf
  t: 'c0703a', // pot
  d: '7a3f1c', // soil, pot rim shadow
  p: 'ff6fae', // petals
};

const POT = [
  'tttttttt',
  'tddddddt',
  ' tttttt ',
  ' tttttt ',
  '  tttt  ',
];
const PX = 4;
const PY = 11;

// height: stem length above the soil (1..6); sway: -1, 0, 1; droop: leaves down.
function plant({ height = 4, sway = 0, droop = false, dry = false, dx = 0 } = {}) {
  const g = k.blank();
  k.stamp(g, POT, PX + dx, PY);
  const leaf = dry ? 'y' : 'g';
  const top = PY - height;
  for (let y = PY - 1; y >= top; y--) {
    const lean = y < PY - 3 ? sway : 0;
    k.put(g, 7 + lean + dx, y, leaf);
  }
  // Two leaves on the stem, one higher up when tall enough.
  const pairs = height >= 4 ? [PY - 2, PY - 4] : height >= 2 ? [PY - 2] : [];
  pairs.forEach((y, i) => {
    const lean = y < PY - 3 ? sway : 0;
    const lx = 7 + lean + dx;
    if (droop) {
      k.stamp(g, ['x ', ' x'], lx - 2, y, { x: leaf });
      k.stamp(g, [' x', 'x '], lx + 1, y, { x: leaf });
    } else {
      k.stamp(g, ['xx', ' x'], lx - 2, y - 1, { x: i ? leaf : 'l' });
      k.stamp(g, ['xx', 'x '], lx + 1, y - 1, { x: leaf });
    }
  });
  return { g, tipX: 7 + sway + dx, tipY: top };
}

const flower = (g, x, y, open) => (open
  ? k.stamp(g, [' p ', 'pYp', ' p '], x - 1, y - 2)
  : k.stamp(g, ['p'], x, y - 1));

// Working: growing from short to tall, then the shared indicator on top.
const grow = (name) => k.WORK[name]().map(({ draw, ms }, i) => {
  const { g } = plant({ height: 4 + (i % 3 === 2 ? 1 : 0), sway: [0, 1, 0, -1][i % 4] });
  return k.frame(draw(g), ms);
});

const STATES = {
  idle: () => [-1, 0, 1, 0].map((sway) => k.frame(plant({ height: 5, sway }).g, 700)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(plant({ height: 5, sway: lit - 1 }).g, lit, 1, 'W', 'V'), 350)),
  // A sprout shooting up, then holding.
  working: () => [1, 2, 3, 4, 5, 6, 6].map((h, i) => k.frame(plant({ height: h }).g, i === 6 ? 500 : 140)),
  working_bash: () => grow('working_bash'),
  working_edit: () => grow('working_edit'),
  working_read: () => grow('working_read'),
  // Thirsty: drooping, with an orange question mark.
  needs_input: () => [0, 1].map((y) => k.frame(k.question(plant({ height: 4, droop: true }).g, 10, y, 'O'), 420)),
  // Bud, then bloom.
  done: () => {
    const bud = plant({ height: 6 });
    const bloom = plant({ height: 6 });
    flower(bud.g, bud.tipX, bud.tipY, false);
    flower(bloom.g, bloom.tipX, bloom.tipY, true);
    k.sparkle(bloom.g, 11, 1);
    return [k.frame(bud.g, 400), k.frame(bloom.g, 1600)];
  },
  // Dried out, shaking, a leaf falling.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => {
    const { g } = plant({ height: 4, droop: true, dry: true, dx });
    k.put(g, 3 + i, 4 + i * 2, 'y');
    return k.frame(k.bang(g, 11, 0, 'R'), i === 4 ? 900 : 120);
  }),
};

module.exports = {
  label: 'Sprout',
  description: 'A potted plant: sways when idle, grows while working, droops when it needs you, blooms when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
