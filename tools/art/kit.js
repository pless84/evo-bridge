// Shared helpers and small indicator sprites for the art themes in
// art/themes/. A frame is { grid, ms }: grid is 16 rows of 16 palette keys,
// '.' is off (black). In sprites, ' ' is transparent.

const SIZE = 16;

// Keys every theme palette includes, so the shared indicators work everywhere.
// Theme-specific keys are lower case.
const ACCENT = {
  '.': '000000',
  W: 'ffffff', // white
  K: '14141c', // near black (pupils)
  G: '50506a', // dim grey
  H: '9a9aa8', // light grey
  C: '39ff6a', // terminal green
  Y: 'ffd23a', // yellow
  P: 'ff8fb0', // pink
  S: '8b5a2b', // brown
  O: 'ff7a1a', // orange (needs you)
  R: 'e8333a', // red (error)
  A: '3ccf5a', // green (done)
  V: '8a6cf0', // violet (thinking)
  U: '3d8bff', // blue (working)
  T: '1fb5a6', // teal (idle)
};

const blank = () => Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
const clone = (g) => g.map((row) => [...row]);
const frame = (grid, ms) => ({ grid, ms });

function put(g, x, y, c) {
  if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = c;
}

// Draw `sprite` (rows of keys, ' ' = transparent) at x, y. `map` recolours keys.
function stamp(g, sprite, x, y, map = {}) {
  sprite.forEach((row, j) => [...row].forEach((c, i) => {
    if (c !== ' ') put(g, x + i, y + j, map[c] || c);
  }));
  return g;
}

// A full grid from up to 16 rows ('.' or ' ' = off); short rows are padded.
function fromRows(rows) {
  const g = blank();
  rows.forEach((row, y) => [...row].slice(0, SIZE).forEach((c, x) => {
    if (c !== ' ' && c !== '.') g[y][x] = c;
  }));
  return g;
}

// Move everything sideways (for a shake), filling with off.
function shift(g, dx) {
  return g.map((row) => row.map((_, x) => row[x - dx] || '.'));
}

function replace(g, from, to) {
  return g.map((row) => row.map((c) => (c === from ? to : c)));
}

// ---- indicators for the top band (rows 0-4) ----

// Three dots, one lit: thinking.
function dots(g, lit, y = 1, on = 'W', off = 'G') {
  [3, 7, 11].forEach((x, i) => stamp(g, ['xx', 'xx'], x, y, { x: i === lit ? on : off }));
  return g;
}

// A ring of 10 pixels with a bright head and a fading tail: busy.
const RING = [[7, 0], [8, 0], [9, 1], [10, 2], [9, 3], [8, 4], [7, 4], [6, 3], [5, 2], [6, 1]];
function spinner(g, f, dx = 0, head = 'W', tail = 'H', rest = 'G') {
  RING.forEach(([x, y], i) => {
    const age = (f - i + RING.length) % RING.length;
    put(g, x + dx, y, age === 0 ? head : age <= 3 ? tail : rest);
  });
  return g;
}

// Terminal prompt ">_" with a blinking cursor.
function prompt(g, cursor, x = 3, y = 0, c = 'C') {
  stamp(g, ['x  ', ' x ', '  x', ' x ', 'x  '], x, y, { x: c });
  if (cursor) stamp(g, ['xxx'], x + 5, y + 4, { x: c });
  return g;
}

// A pencil drawing a white line; tipX from 3 to 11.
function pencil(g, tipX, y = 0) {
  for (let x = 3; x < tipX; x++) put(g, x, y + 5 > 15 ? 15 : y + 5, 'W');
  return stamp(g, ['    P', '   Y ', '  Y  ', ' Y   ', 'S    '], tipX, y);
}

// An open book; `line` (1 or 3) and `side` ('left' or 'right') light up.
function book(g, line, side, x = 4, y = 0) {
  stamp(g, ['WWWSWWW', 'GGWSGGW', 'WWWSWWW', 'GGWSGGW', 'SSSSSSS'], x, y);
  const x0 = side === 'left' ? x : x + 4;
  for (let i = x0; i < x0 + 3; i++) if (g[y + line][i] === 'G') put(g, i, y + line, 'Y');
  return g;
}

const QUESTION = [' xx ', 'x  x', '  x ', '    ', '  x '];
const question = (g, x, y, c = 'O') => stamp(g, QUESTION, x, y, { x: c });

const CHECK = ['    x', '   x ', 'x x  ', ' x   '];
const check = (g, x, y, c = 'W') => stamp(g, CHECK, x, y, { x: c });

const BANG = ['xx', 'xx', 'xx', '  ', 'xx'];
const bang = (g, x, y, c = 'W') => stamp(g, BANG, x, y, { x: c });

const SPARKLE = [' Y ', 'YWY', ' Y '];
const sparkle = (g, x, y) => stamp(g, SPARKLE, x, y);

const CROSS = ['x   x', ' x x ', '  x  ', ' x x ', 'x   x'];
const cross = (g, x, y, c = 'W') => stamp(g, CROSS, x, y, { x: c });

// The working variants as small top-band overlays, frame by frame.
// Each returns [{ draw(g), ms }] so a theme can put them over its own body.
const WORK = {
  working: () => RING.map((_, f) => ({ draw: (g) => spinner(g, f), ms: 90 })),
  working_bash: () => [true, false].map((on) => ({ draw: (g) => prompt(g, on), ms: 450 })),
  working_edit: () => [3, 5, 7, 9, 11].map((tip) => ({ draw: (g) => pencil(g, tip), ms: 220 })),
  working_read: () => [[1, 'left'], [1, 'right'], [3, 'left'], [3, 'right']]
    .map(([line, side]) => ({ draw: (g) => book(g, line, side), ms: 380 })),
};

// A circle of pixel positions around (cx, cy), ordered by angle.
function circle(cx, cy, r) {
  const pts = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r) < 0.55) pts.push([x, y, Math.atan2(y - cy, x - cx)]);
    }
  }
  return pts.sort((a, b) => a[2] - b[2]).map(([x, y]) => [x, y]);
}

module.exports = {
  SIZE, ACCENT, blank, clone, frame, put, stamp, fromRows, shift, replace,
  dots, spinner, prompt, pencil, book, question, check, bang, sparkle, cross, circle, WORK, RING,
};
