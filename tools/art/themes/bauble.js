// "Bauble": a Christmas ball hanging from its cap. The ball's colour shows
// the state, like Blip; it swings gently when idle and cracks on an error.
const k = require('../kit');

const PALETTE = { ...k.ACCENT };

// Row widths of the ball, rows 6..15. The gold cap sits on row 5; the top
// band (rows 0..4) is free for indicators.
const WIDTHS = [6, 8, 10, 10, 10, 10, 10, 10, 8, 6];
const BAND_Y = 11;

// color: palette key of the ball. band: 0 or 1, which half of the gold and
// white band pattern is gold. shine: draw the highlight.
function ball({ dx = 0, color = 'T', band = 0, shine = true, cracked = false } = {}) {
  const g = k.blank();
  k.stamp(g, ['YY'], 7 + dx, 5);
  WIDTHS.forEach((w, i) => {
    for (let x = 8 - w / 2; x < 8 + w / 2; x++) {
      const y = 6 + i;
      k.put(g, x + dx, y, y === BAND_Y ? ((x + band) % 2 ? 'W' : 'Y') : color);
    }
  });
  if (shine) k.stamp(g, [' W', 'W ', 'W '], 5 + dx, 7);
  if (cracked) k.stamp(g, ['K ', ' K', 'K ', ' K', 'K '], 9 + dx, 6);
  return g;
}

const working = (name) => k.WORK[name]().map(({ draw, ms }, i) => k.frame(draw(ball({ color: 'U', band: i % 2 })), ms));

const STATES = {
  // Swinging slowly; the highlight glints as it passes the middle.
  idle: () => [0, 1, 0, -1].map((dx, i) => k.frame(ball({ dx, shine: i % 2 === 0 }), 700)),
  thinking: () => [0, 1, 2].map((lit) => k.frame(k.dots(ball({ color: 'V', band: lit % 2 }), lit, 1, 'W', 'V'), 350)),
  working: () => working('working'),
  working_bash: () => working('working_bash'),
  working_edit: () => working('working_edit'),
  working_read: () => working('working_read'),
  // Swinging hard to get your attention.
  needs_input: () => [-1, 1].map((dx, f) => k.frame(k.question(ball({ dx, color: 'O', band: f }), 6, 0, 'O'), 420)),
  done: () => [0, 1].map((f) => {
    const g = k.check(ball({ color: 'A', band: f }), 5, 0, 'A');
    return k.frame(k.sparkle(g, f ? 13 : 0, 2), 550);
  }),
  // Cracked and shaking.
  error: () => [-1, 1, -1, 1, 0].map((dx, i) => k.frame(
    k.bang(ball({ dx, color: 'R', shine: false, cracked: true }), 7 + dx, 0, 'R'), i === 4 ? 900 : 90)),
};

module.exports = {
  label: 'Christmas ball',
  description: 'A Christmas ball whose colour shows the state: it swings gently when idle and cracks on an error.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
