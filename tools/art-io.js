// Reading and writing a state's art as frames, for the companion app's pixel
// editor (through the laptop bridge). Edited art is saved per theme as
// art/custom/<theme>/<state>.gif, where build-states.js looks first, so the
// ESP32 firmware picks it up too after `npm run states -- --theme <theme>`.
//
// frames: [{ pixels: 256 RGB hex strings ('rrggbb', row-major), ms }]
const fs = require('fs');
const path = require('path');
const { GifFrame, GifCodec } = require('gifwrap');
const encode = require('./evo-encode');
const { loadArt, SIZE } = require('./load-art');
const { sourceFor, customFiles, CUSTOM_DIR } = require('./build-states');
const themes = require('./art/themes');

const MAX_FRAMES = 64;
const MAX_MESSAGES = 255; // the firmware's limit per state (states.h)
const HEX = /^[0-9a-f]{6}$/;

const EDITABLE = themes.STATE_NAMES; // every state except the built-in clock
const isEditable = (state) => EDITABLE.includes(state);

// Problems with a frames list; empty = fine.
function problems(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return ['frames must be a non-empty list'];
  if (frames.length > MAX_FRAMES) return [`at most ${MAX_FRAMES} frames`];
  const out = [];
  frames.forEach((f, i) => {
    if (!f || typeof f !== 'object') return out.push(`frame ${i}: not an object`);
    if (!Array.isArray(f.pixels) || f.pixels.length !== SIZE * SIZE) out.push(`frame ${i}: needs ${SIZE * SIZE} pixels`);
    else if (!f.pixels.every((c) => typeof c === 'string' && HEX.test(c))) out.push(`frame ${i}: pixels must be 'rrggbb' (lowercase hex)`);
    // GIF stores delays in 1/100 s.
    if (!(Number.isInteger(f.ms) && f.ms >= 0 && f.ms <= 65530 && f.ms % 10 === 0)) {
      out.push(`frame ${i}: ms must be 0-65530 in steps of 10`);
    }
  });
  if (!out.length) {
    const n = encode.animation(frames).length;
    if (n > MAX_MESSAGES) out.push(`too big for the Evo (${n} messages, max ${MAX_MESSAGES}): use fewer frames or colours`);
  }
  return out;
}

// { state, theme, custom, frames }
async function readArt(state, theme = themes.DEFAULT_THEME) {
  const { file, custom } = sourceFor(state, { theme });
  const { frames } = await loadArt(file);
  return { state, theme, custom, frames: frames.map(({ pixels, ms }) => ({ pixels, ms: Math.round(ms / 10) * 10 })) };
}

async function gifBuffer(frames) {
  const gifFrames = frames.map(({ pixels, ms }) => {
    const buf = Buffer.alloc(SIZE * SIZE * 4);
    pixels.forEach((hex, i) => {
      const n = parseInt(hex, 16);
      buf[i * 4] = (n >> 16) & 255;
      buf[i * 4 + 1] = (n >> 8) & 255;
      buf[i * 4 + 2] = n & 255;
      buf[i * 4 + 3] = 255;
    });
    return new GifFrame(SIZE, SIZE, buf, { delayCentisecs: ms / 10, disposalMethod: 1 });
  });
  const gif = await new GifCodec().encodeGif(gifFrames, { loops: 0 });
  return gif.buffer;
}

// Save as art/custom/<theme>/<state>.gif (atomically). Frames must be valid.
async function writeArt(state, frames, theme = themes.DEFAULT_THEME) {
  const [file, ...others] = customFiles(state, theme);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, await gifBuffer(frames));
  fs.renameSync(tmp, file);
  // Keep one source per state.
  for (const f of others) fs.rmSync(f, { force: true });
  return file;
}

// Back to the theme's starter art.
function removeArt(state, theme = themes.DEFAULT_THEME) {
  for (const f of customFiles(state, theme)) fs.rmSync(f, { force: true });
}

module.exports = { EDITABLE, isEditable, problems, readArt, writeArt, removeArt, gifBuffer, MAX_FRAMES, CUSTOM_DIR };
