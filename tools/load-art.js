// Loads a GIF or PNG as 16x16 frames of RGB hex pixels: [{ pixels, ms }].
// GIF frames are composited the way a viewer would show them (offsets,
// transparency, disposal), and art of another size is scaled with nearest
// neighbour, so pixel art stays crisp.
const fs = require('fs');
const { GifCodec } = require('gifwrap');
const { PNG } = require('pngjs');

const SIZE = 16;
const hex = (r, g, b) => [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// RGBA canvas (w x h) -> 256 hex pixels.
function toPixels(rgba, w, h) {
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.floor((x * w) / SIZE);
      const sy = Math.floor((y * h) / SIZE);
      const i = (sy * w + sx) * 4;
      // Transparent shows as off (black) on the LEDs.
      out.push(rgba[i + 3] < 128 ? '000000' : hex(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
  }
  return out;
}

async function loadGif(buf) {
  const gif = await new GifCodec().decodeGif(buf);
  const w = gif.width;
  const h = gif.height;
  const canvas = Buffer.alloc(w * h * 4); // starts transparent
  const frames = [];
  for (const f of gif.frames) {
    const { width: fw, height: fh, data } = f.bitmap;
    const before = f.disposalMethod === 3 ? Buffer.from(canvas) : null;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const cx = x + f.xOffset;
        const cy = y + f.yOffset;
        if (cx >= w || cy >= h) continue;
        const s = (y * fw + x) * 4;
        if (data[s + 3] < 128) continue; // transparent: keep what is below
        data.copy(canvas, (cy * w + cx) * 4, s, s + 4);
      }
    }
    frames.push({ pixels: toPixels(canvas, w, h), ms: f.delayCentisecs * 10 });
    if (f.disposalMethod === 2) {
      for (let y = 0; y < fh; y++) {
        const start = ((y + f.yOffset) * w + f.xOffset) * 4;
        canvas.fill(0, start, start + Math.min(fw, w - f.xOffset) * 4);
      }
    } else if (before) {
      before.copy(canvas);
    }
  }
  return frames;
}

function loadPng(buf) {
  const png = PNG.sync.read(buf);
  return [{ pixels: toPixels(png.data, png.width, png.height), ms: 0 }];
}

// Returns { frames, animated }.
async function loadArt(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') {
    const frames = await loadGif(buf);
    return { frames, animated: true };
  }
  if (buf.subarray(1, 4).toString('latin1') === 'PNG') return { frames: loadPng(buf), animated: false };
  throw new Error(`${file}: not a GIF or PNG`);
}

module.exports = { loadArt, SIZE };
