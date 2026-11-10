// "Snowman": a snowman with a hat, a carrot nose, a red scarf and stick arms.
// Snow falls when idle; he waves his arms when he needs you.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  w: 'e8f0ff', // snow
};

// Rows 5..15; the top band (rows 0..4) is free for indicators.
const BODY = [
  '   GGGGGG   ',
  '  GGGGGGGG  ',
  '   wwwwww   ',
  '  wwwwwwww  ',
  '  wwwwwwww  ',
  '  wwwOOwww  ',
  '   wwwwww   ',
  '  RRRRRRRR  ',
  ' wwwwwwRRww ',
  'wwwwwwwwwwww',
  'wwwwwwwwwwww',
];
const X = 2;
const Y = 5;

// Stick arms from the left shoulder; the right arm is the mirror image.
const ARM = {
  down: [[2, 13], [1, 13], [0, 12]],
  up: [[2, 13], [1, 12], [0, 11], [0, 10]],
};

function snowman({ dx = 0, left = 'down', right = 'down', eyes = 'open' } = {}) {
  const g = k.blank();
  k.stamp(g, BODY, X + dx, Y);
  ARM[left].forEach(([x, y]) => k.put(g, x + dx, y, 'S'));
  ARM[right].forEach(([x, y]) => k.put(g, 15 - x + dx, y, 'S'));
  return k.eyes(g, eyes, X + 3 + dx, X + 7 + dx, Y + 3, eyes === 'closed' ? 'H' : 'K');
}

// Snowflakes drifting down the top band, beside the hat.
function snow(g, f) {
  [[1, 0], [14, 2], [4, 3], [11, 1]].forEach(([x, start]) => k.put(g, x, (start + f) % 5, 'w'));
  return g;
}

const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(
  draw(snowman({ left: i % 2 ? 'up' : 'down', right: i % 2 ? 'down' : 'up' })), ms));

const STATES = {
  idle: () => [0, 1, 2, 3, 4].map((f) => k.frame(snow(snowman({ eyes: f === 4 ? 'closed' : 'open' }), f), 500)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(snowman({ eyes: 'up' }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Waving at you.
  needs_input: () => [0, 1].map((f) => k.frame(
    k.question(snowman({ left: f ? 'up' : 'down', right: f ? 'down' : 'up' }), 6, 0, 'O'), 420)),
  // Arms in the air.
  done: () => [0, 1].map((f) => {
    const g = k.check(snowman({ left: 'up', right: 'up', eyes: 'happy' }), 5, 0, 'A');
    return k.frame(k.sparkle(g, f ? 12 : 1, 1), 550);
  }),
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => k.frame(
    k.bang(snowman({ dx, eyes: 'upset' }), 7 + dx, 0, 'R'), i === 4 ? 900 : 90)),
};

module.exports = {
  label: 'Snowman',
  description: 'A snowman in the falling snow: waves his stick arms when he needs you, throws them up when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
