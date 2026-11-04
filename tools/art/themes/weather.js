// "Weather": a little sky. Stars at night when idle, clouds gathering while
// thinking, rain (or snow, or wind) while working, a rainbow when it needs
// you, sunshine when done and a thunderstorm on errors.
const k = require('../kit');

const PALETTE = {
  ...k.ACCENT,
  c: 'b0b8c8', // cloud
  e: '6a7488', // dark cloud
  s: 'ffe066', // sun
  m: 'f0f0d8', // moon
  b: '4aa8ff', // rain
  n: '1d2a4a', // night sky dot
};

const CLOUD = [
  '   xxxx   ',
  ' xxxxxxxx ',
  'xxxxxxxxxx',
  ' xxxxxxxx ',
];
const cloud = (g, x, y, c = 'c') => k.stamp(g, CLOUD, x, y, { x: c });

const MOON = [' xxx', 'xx  ', 'xx  ', 'xx  ', ' xxx'];
const STARS = [[2, 2], [12, 1], [9, 4], [4, 8], [13, 9], [1, 12], [10, 13], [6, 14]];

const SUN = ['  xxxx  ', ' xxxxxx ', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', ' xxxxxx ', '  xxxx  '];
const RAYS = [
  [[7, 0], [8, 0], [7, 15], [8, 15], [0, 7], [0, 8], [15, 7], [15, 8]],
  [[2, 2], [13, 2], [2, 13], [13, 13], [3, 3], [12, 3], [3, 12], [12, 12]],
];

function sky() {
  return k.blank();
}

// Falling things under a cloud: offset f shifts them down.
function precipitation(f, kind) {
  const g = sky();
  cloud(g, 3, 1);
  const cols = [3, 5, 7, 9, 11, 12];
  cols.forEach((x, i) => {
    for (let y = 6; y < 16; y++) {
      if ((y + f + i * 2) % 4 !== 0) continue;
      if (kind === 'rain') { k.put(g, x, y, 'b'); k.put(g, x, y + 1, 'b'); }
      if (kind === 'snow') k.put(g, x + ((y + i) % 2), y, 'W');
    }
  });
  return g;
}

const BOLT = ['  xx', ' xx ', 'xxxx', ' xx ', 'xx  ', 'x   '];

const STATES = {
  // Night: a moon and twinkling stars.
  idle: () => [0, 1, 2].map((f) => {
    const g = sky();
    k.stamp(g, MOON, 10, 2, { x: 'm' });
    STARS.forEach(([x, y], i) => k.put(g, x, y, (i + f) % 3 === 0 ? 'W' : 'n'));
    return k.frame(g, 900);
  }),
  // Clouds drifting together, in violet-grey.
  thinking: () => [0, 1, 2, 3].map((f) => {
    const g = sky();
    cloud(g, -3 + f, 3, 'e');
    cloud(g, 9 - f, 7, 'c');
    k.put(g, 7, 13, f % 2 ? 'V' : 'W');
    return k.frame(g, 330);
  }),
  working: () => [0, 1, 2, 3].map((f) => k.frame(precipitation(f, 'rain'), 130)),
  working_bash: () => [0, 1, 2, 3].map((f) => {
    const g = precipitation(f, 'rain');
    for (let y = 9; y < 16; y++) for (let x = 1; x < 13; x++) k.put(g, x, y, '.'); // clear a spot
    k.prompt(g, f % 2 === 0, 3, 10, 'C');
    return k.frame(g, 200);
  }),
  // Snow for editing.
  working_edit: () => [0, 1, 2, 3].map((f) => k.frame(precipitation(f, 'snow'), 260)),
  // Wind for reading: streaks blowing across.
  working_read: () => [0, 1, 2, 3].map((f) => {
    const g = sky();
    cloud(g, 3, 1);
    [[7, 0], [10, 5], [13, 2]].forEach(([y, off]) => {
      for (let i = 0; i < 5; i++) k.put(g, (i + off + f * 3) % 16, y, 'H');
    });
    return k.frame(g, 200);
  }),
  // A rainbow, blinking between bright and dim.
  needs_input: () => [true, false].map((bright) => {
    const g = sky();
    const bands = bright ? ['R', 'O', 'Y', 'A', 'U'] : ['O'];
    bands.forEach((c, i) => k.circle(7.5, 13, 7 - i).forEach(([x, y]) => {
      if (y <= 13) k.put(g, x, y, c);
    }));
    return k.frame(g, bright ? 600 : 300);
  }),
  // Sunshine with turning rays.
  done: () => [0, 1].map((f) => {
    const g = sky();
    k.stamp(g, SUN, 4, 4, { x: 's' });
    RAYS[f].forEach(([x, y]) => k.put(g, x, y, 'Y'));
    return k.frame(g, 500);
  }),
  // Storm: dark cloud, rain, and a lightning flash.
  error: () => [true, false, true, false].map((flash, i) => {
    const g = precipitation(i, 'rain');
    cloud(g, 3, 1, 'e');
    if (flash) k.stamp(g, BOLT, 6, 5, { x: 'Y' });
    return k.frame(g, flash ? 120 : i === 3 ? 900 : 200);
  }),
};

module.exports = {
  label: 'Weather',
  description: 'A little sky: stars when idle, rain while working, a rainbow when it needs you, sun when done.',
  STATES: Object.fromEntries(Object.entries(STATES).map(([s, f]) => [s, { frames: f() }])),
  paletteFor: () => PALETTE,
};
