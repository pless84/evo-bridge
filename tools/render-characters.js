// Renders docs/characters.png for the README: every character (columns, in
// art/themes order) in six of its states (rows: idle, thinking, working,
// needs_input, done, error), drawn as LEDs.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { SIZE } = require('./art/sprites');
const themes = require('./art/themes');

const OUT = path.join(__dirname, '..', 'docs', 'characters.png');
const STATES = ['idle', 'thinking', 'working', 'needs_input', 'done', 'error'];
const LED = 6; // px per LED
const GAP = 2; // px between LEDs
const CELL = SIZE * (LED + GAP) - GAP;
const SPACE = 12; // px between cells
const MARGIN = 16;
const BACKGROUND = '0a0a0c';
const OFF = '18181c'; // an unlit LED

const ids = Object.keys(themes.THEMES);
const W = 2 * MARGIN + ids.length * CELL + (ids.length - 1) * SPACE;
const H = 2 * MARGIN + STATES.length * CELL + (STATES.length - 1) * SPACE;
const png = new PNG({ width: W, height: H });

function rect(x0, y0, w, h, hex) {
  const n = parseInt(hex, 16);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = (n >> 16) & 255;
      png.data[i + 1] = (n >> 8) & 255;
      png.data[i + 2] = n & 255;
      png.data[i + 3] = 255;
    }
  }
}

const showsRed = (f) => f.grid.some((row) => row.includes('R'));

// The frame that stands for a state: the first one, but for error the last
// one that shows red (some blink it off in their last frame).
function pick(frames, state) {
  if (state !== 'error') return frames[0];
  return [...frames].reverse().find(showsRed) || frames[frames.length - 1];
}

rect(0, 0, W, H, BACKGROUND);
ids.forEach((id, col) => {
  const theme = themes.THEMES[id];
  STATES.forEach((state, row) => {
    const palette = theme.paletteFor(state);
    const x0 = MARGIN + col * (CELL + SPACE);
    const y0 = MARGIN + row * (CELL + SPACE);
    pick(theme.STATES[state].frames, state).grid.forEach((line, y) => line.forEach((key, x) => {
      const hex = palette[key];
      rect(x0 + x * (LED + GAP), y0 + y * (LED + GAP), LED, LED, hex === '000000' ? OFF : hex);
    }));
  });
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PNG.sync.write(png, { colorType: 2 }));
console.log(`characters -> docs/characters.png (${W}x${H}; columns: ${ids.join(', ')})`);
