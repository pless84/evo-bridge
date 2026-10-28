// Starter pixel art for the Evo pet ("Blip", a small round blob).
// Every state is a list of 16x16 frames built from small sprites.
// Each frame is { grid: string[16][16] of palette keys, ms: delay }.
//
// To use your own art instead, drop a 16x16 GIF (or PNG) named
// <state>.gif / <state>.png into tools/art/custom/ and run `npm run build`.

const SIZE = 16;

// Shared palette. '.' is the background (LEDs off).
const BASE = {
  '.': '000000',
  W: 'ffffff', // white (eyes, highlights)
  K: '14141c', // pupils / dark features
  G: '50506a', // dim grey
};

// Body colours per state, so the state is readable from across the room.
const BODY = {
  idle:        { B: '1fb5a6', D: '0f6e65', L: '7ff0e3' }, // teal
  thinking:    { B: '8a6cf0', D: '4b38a0', L: 'c9b9ff' }, // violet
  working:     { B: '3d8bff', D: '1d4fa8', L: 'a8cbff' }, // blue
  needs_input: { B: 'ff7a1a', D: 'a8480a', L: 'ffc08a' }, // orange
  done:        { B: '3ccf5a', D: '1e7a32', L: 'a6f5b5' }, // green
  error:       { B: 'e8333a', D: '8a1418', L: 'ff9a9e' }, // red
};

const ACCENT = {
  C: '39ff6a', // terminal green
  Y: 'ffd23a', // yellow
  P: 'ff8fb0', // pencil eraser pink
  S: '8b5a2b', // book spine brown
};

// ---------- sprites (' ' = transparent) ----------

const BODY_SPRITE = [
  '    BBBBBB    ',
  '  BBLLBBBBBB  ',
  ' BBLBBBBBBBBB ',
  ' BBBBBBBBBBBB ',
  'BBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBB',
  ' DBBBBBBBBBBD ',
  '  DD      DD  ',
];
const BODY_X = 1;
const BODY_Y = 6;

// ---------- helpers ----------

function blank() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
}

function put(g, x, y, c) {
  if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = c;
}

function stamp(g, sprite, x, y) {
  sprite.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c !== ' ') put(g, x + i, y + j, c);
    });
  });
}

// Eye whites are 2x3 at (4,9) and (10,9). Pupils are 1x2.
// look: 'forward' | 'left' | 'right' | 'up' | 'down'
function eyes(g, look = 'forward', dx = 0) {
  const lx = 4 + dx;
  const rx = 10 + dx;
  for (const ex of [lx, rx]) {
    for (let y = 9; y <= 11; y++) {
      put(g, ex, y, 'W');
      put(g, ex + 1, y, 'W');
    }
  }
  let lcol, rcol, top;
  switch (look) {
    case 'left':  lcol = 0; rcol = 0; top = 10; break;
    case 'right': lcol = 1; rcol = 1; top = 10; break;
    case 'up':    lcol = 1; rcol = 0; top = 9; break;
    case 'down':  lcol = 1; rcol = 0; top = 10; break;
    default:      lcol = 1; rcol = 0; top = 10; break;
  }
  put(g, lx + lcol, top, 'K');
  put(g, lx + lcol, top + 1, 'K');
  put(g, rx + rcol, top, 'K');
  put(g, rx + rcol, top + 1, 'K');
}

function blinkEyes(g, dx = 0) {
  for (const ex of [4 + dx, 10 + dx]) {
    put(g, ex, 11, 'D');
    put(g, ex + 1, 11, 'D');
  }
}

function happyEyes(g) {
  stamp(g, [' K ', 'K K'], 3, 10);
  stamp(g, [' K ', 'K K'], 10, 10);
}

function xEyes(g, dx = 0) {
  stamp(g, ['K K', ' K ', 'K K'], 3 + dx, 9);
  stamp(g, ['K K', ' K ', 'K K'], 10 + dx, 9);
}

function mouth(g, kind = 'neutral', dx = 0) {
  const m = {
    neutral: [[7, 13, 'D'], [8, 13, 'D']],
    smile:   [[6, 13, 'D'], [9, 13, 'D'], [7, 14, 'D'], [8, 14, 'D']],
    open:    [[7, 13, 'K'], [8, 13, 'K'], [7, 14, 'K'], [8, 14, 'K']],
    frown:   [[7, 13, 'D'], [8, 13, 'D'], [6, 14, 'D'], [9, 14, 'D']],
  }[kind];
  m.forEach(([x, y, c]) => put(g, x + dx, y, c));
}

function pet({ look = 'forward', blink = false, mouthKind = 'neutral', dx = 0 } = {}) {
  const g = blank();
  stamp(g, BODY_SPRITE, BODY_X + dx, BODY_Y);
  if (blink) blinkEyes(g, dx);
  else eyes(g, look, dx);
  mouth(g, mouthKind, dx);
  return g;
}

const frame = (grid, ms) => ({ grid, ms });

// ---------- states ----------

function idle() {
  return [
    frame(pet(), 2500),
    frame(pet({ blink: true }), 150),
    frame(pet(), 1200),
    frame(pet({ blink: true }), 150),
  ];
}

function thinking() {
  const dots = [[3, 2], [7, 2], [11, 2]];
  return [0, 1, 2].map((hi) => {
    const g = pet({ look: 'up' });
    dots.forEach(([x, y], i) => {
      const c = i === hi ? 'W' : 'G';
      stamp(g, [c + c, c + c], x, y);
    });
    return frame(g, 350);
  });
}

// Generic "working": a small spinner above the head.
function working() {
  const ring = [[7, 0], [8, 0], [9, 1], [10, 2], [9, 3], [8, 4], [7, 4], [6, 3], [5, 2], [6, 1]];
  return ring.map((_, f) => {
    const g = pet({ look: 'down' });
    ring.forEach(([x, y], i) => {
      const age = (f - i + ring.length) % ring.length;
      if (age === 0) put(g, x, y, 'W');
      else if (age <= 3) put(g, x, y, 'L');
      else put(g, x, y, 'G');
    });
    return frame(g, 90);
  });
}

// Bash: a terminal prompt with a blinking cursor.
function workingBash() {
  const prompt = ['C  ', ' C ', '  C', ' C ', 'C  '];
  return [true, false].map((cursor) => {
    const g = pet({ look: 'down' });
    stamp(g, prompt, 3, 0);
    if (cursor) stamp(g, ['CCC'], 8, 4);
    return frame(g, 450);
  });
}

// Edit: a pencil drawing a line.
function workingEdit() {
  const pencil = ['    P', '   Y ', '  Y  ', ' Y   ', 'S    '];
  return [3, 5, 7, 9, 11].map((tipX) => {
    const g = pet({ look: 'left' });
    for (let x = 3; x < tipX; x++) put(g, x, 5, 'W');
    stamp(g, pencil, tipX, 0);
    return frame(g, 220);
  });
}

// Read: an open book; eyes scan across the pages.
function workingRead() {
  const book = [
    'WWWSWWW',
    'GGWSGGW',
    'WWWSWWW',
    'GGWSGGW',
    'SSSSSSS',
  ];
  const steps = [
    { look: 'left', line: 1 },
    { look: 'right', line: 1 },
    { look: 'left', line: 3 },
    { look: 'right', line: 3 },
  ];
  return steps.map(({ look, line }) => {
    const g = pet({ look });
    stamp(g, book, 4, 0);
    // highlight the line being read on the side the eyes look at
    const x0 = look === 'left' ? 4 : 8;
    for (let x = x0; x < x0 + 3; x++) if (g[line][x] === 'G') put(g, x, line, 'Y');
    return frame(g, 380);
  });
}

function needsInput() {
  const q = [' YY ', 'Y  Y', '  Y ', '    ', '  Y '];
  return [0, 1].map((y) => {
    const g = pet({ mouthKind: 'open' });
    stamp(g, q, 6, y);
    return frame(g, 420);
  });
}

function done() {
  const check = ['    W', '   W ', 'W W  ', ' W   '];
  const sparkle = [' Y ', 'YWY', ' Y '];
  return [0, 1].map((f) => {
    const g = blank();
    stamp(g, BODY_SPRITE, BODY_X, BODY_Y);
    happyEyes(g);
    mouth(g, 'smile');
    stamp(g, check, 5, 1);
    if (f === 0) stamp(g, sparkle, 0, 0);
    else stamp(g, sparkle, 12, 2);
    return frame(g, 550);
  });
}

function error() {
  const bang = ['WW', 'WW', 'WW', '  ', 'WW'];
  const shake = [-1, 1, -1, 1, 0];
  return shake.map((dx, i) => {
    const g = blank();
    stamp(g, BODY_SPRITE, BODY_X + dx, BODY_Y);
    xEyes(g, dx);
    mouth(g, 'frown', dx);
    stamp(g, bang, 7 + dx, 0);
    return frame(g, i === shake.length - 1 ? 900 : 90);
  });
}

// name -> { body colour set, frames }
const STATES = {
  idle:          { body: 'idle',        frames: idle() },
  thinking:      { body: 'thinking',    frames: thinking() },
  working:       { body: 'working',     frames: working() },
  working_bash:  { body: 'working',     frames: workingBash() },
  working_edit:  { body: 'working',     frames: workingEdit() },
  working_read:  { body: 'working',     frames: workingRead() },
  needs_input:   { body: 'needs_input', frames: needsInput() },
  done:          { body: 'done',        frames: done() },
  error:         { body: 'error',       frames: error() },
};

function paletteFor(state) {
  return { ...BASE, ...ACCENT, ...BODY[STATES[state].body] };
}

module.exports = { SIZE, STATES, paletteFor };
