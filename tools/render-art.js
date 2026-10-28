// Renders the starter art in art/sprites.js to 16x16 GIFs (art/gif/<state>.gif)
// and a scaled-up preview sheet (art/preview/sheet.png) for eyeballing.
const fs = require('fs');
const path = require('path');
const { GifFrame, GifUtil, GifCodec } = require('gifwrap');
const { PNG } = require('pngjs');
const { SIZE, STATES, paletteFor } = require('./art/sprites');

const GIF_DIR = path.join(__dirname, 'art', 'gif');
const PREVIEW_DIR = path.join(__dirname, 'art', 'preview');
const SCALE = 8;

function rgba(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function validate(state, grid, palette) {
  if (grid.length !== SIZE) throw new Error(`${state}: frame has ${grid.length} rows`);
  grid.forEach((row, y) => {
    if (row.length !== SIZE) throw new Error(`${state}: row ${y} has ${row.length} cols`);
    row.forEach((c) => {
      if (!(c in palette)) throw new Error(`${state}: unknown palette key '${c}'`);
    });
  });
}

function frameBuffer(grid, palette) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  grid.forEach((row, y) => row.forEach((c, x) => {
    rgba(palette[c]).forEach((v, i) => { buf[(y * SIZE + x) * 4 + i] = v; });
  }));
  return buf;
}

async function main() {
  fs.mkdirSync(GIF_DIR, { recursive: true });
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const names = Object.keys(STATES);
  const maxFrames = Math.max(...names.map((n) => STATES[n].frames.length));
  const cell = SIZE * SCALE + 4;
  const sheet = new PNG({ width: maxFrames * cell, height: names.length * cell });
  sheet.data.fill(40); // dark grey gutters
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;

  for (const [row, name] of names.entries()) {
    const palette = paletteFor(name);
    const gifFrames = STATES[name].frames.map(({ grid, ms }, col) => {
      validate(name, grid, palette);
      const buf = frameBuffer(grid, palette);
      // preview
      for (let y = 0; y < SIZE * SCALE; y++) {
        for (let x = 0; x < SIZE * SCALE; x++) {
          const src = ((Math.floor(y / SCALE) * SIZE) + Math.floor(x / SCALE)) * 4;
          const dst = (((row * cell + 2 + y) * sheet.width) + col * cell + 2 + x) * 4;
          buf.copy(sheet.data, dst, src, src + 4);
        }
      }
      return new GifFrame(SIZE, SIZE, buf, { delayCentisecs: Math.round(ms / 10) });
    });
    const out = path.join(GIF_DIR, `${name}.gif`);
    await GifUtil.write(out, gifFrames, { loops: 0 }, new GifCodec());
    console.log(`  ${name.padEnd(13)} ${gifFrames.length} frames -> art/gif/${name}.gif`);
  }

  fs.writeFileSync(path.join(PREVIEW_DIR, 'sheet.png'), PNG.sync.write(sheet));
  console.log(`  preview      -> art/preview/sheet.png (rows: ${names.join(', ')})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
