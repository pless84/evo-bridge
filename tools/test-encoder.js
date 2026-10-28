// `npm test`: checks evo-encode.js against output frozen from
// node-divoom-timebox-evo 0.3.0 (the reference this encoder was ported from),
// and checks GIF/PNG loading.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GifFrame, GifCodec } = require('gifwrap');
const { PNG } = require('pngjs');
const encode = require('./evo-encode');
const { loadArt } = require('./load-art');
const { buildHeader } = require('./build-states');

const HOST_FIXTURES = path.join(__dirname, '..', 'firmware', 'test', 'host', 'fixtures.h');
const GOLDEN_STATES = path.join(__dirname, 'test', 'golden', 'states.h');
const TMP = path.join(__dirname, 'test', '.tmp');

// Read `static const uint8_t NAME[] = { 0x.., ... };` arrays from a header.
function cArrays(file) {
  const out = {};
  const re = /static const uint8_t (\w+)\[\][^=]*=\s*\{([^}]*)\}/g;
  for (const [, name, body] of fs.readFileSync(file, 'utf8').matchAll(re)) {
    out[name] = Buffer.from(body.split(',').map((s) => s.trim()).filter(Boolean).map(Number));
  }
  return out;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('starter art builds the exact library bytes', async () => {
  const h = await buildHeader({ starterOnly: true });
  assert.strictEqual(h, fs.readFileSync(GOLDEN_STATES, 'utf8'));
});

test('text and brightness match the library', () => {
  const fx = cArrays(HOST_FIXTURES);
  const text = encode.text('Hi Evo!');
  text.forEach((m, i) => assert.deepStrictEqual(m, fx[`FIX_TEXT_${i}`], `text message ${i}`));
  assert.deepStrictEqual(encode.brightness(50)[0], fx.FIX_BRIGHTNESS_50);
});

test('pixel packing is LSB first with minimal bits', () => {
  assert.deepStrictEqual(encode.packPixels([1, 0, 1, 1, 0, 0, 0, 0], 2), [0b00001101]);
  assert.deepStrictEqual(encode.packPixels([3, 1], 3), [0b0111]);  // 2 bits each
  assert.deepStrictEqual(encode.packPixels([0, 0], 1), [0]);        // 1 colour still uses 1 bit
});

test('animations are split into 200-byte chunks', () => {
  const noise = Array.from({ length: 256 }, (_, i) => (i * 2654435761 >>> 8 & 0xffffff).toString(16).padStart(6, '0'));
  const msgs = encode.animation([{ pixels: noise, ms: 100 }]);
  assert.ok(msgs.length > 1);
  msgs.forEach((m, i) => {
    assert.strictEqual(m[3], 0x49);
    assert.strictEqual(m[6], i);  // chunk number
    assert.ok(m.length <= 200 + 10);
  });
});

async function writeGif(file, frames, size = 16) {
  const gifFrames = frames.map((f) => new GifFrame(f.w || size, f.h || size, f.data, {
    xOffset: f.x || 0, yOffset: f.y || 0, disposalMethod: f.dispose || 1, delayCentisecs: 10,
  }));
  const gif = await new GifCodec().encodeGif(gifFrames, { loops: 0 });
  // encodeGif sizes the canvas from the frames; pin it to `size`
  gif.buffer.writeUInt16LE(size, 6);
  gif.buffer.writeUInt16LE(size, 8);
  fs.writeFileSync(file, gif.buffer);
}

const solid = (w, h, rgba) => Buffer.from(Array.from({ length: w * h }, () => rgba).flat());

test('GIF partial frames are composited onto the canvas', async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, 'partial.gif');
  await writeGif(file, [
    { data: solid(16, 16, [255, 0, 0, 255]) },                         // red background
    { w: 2, h: 2, x: 5, y: 3, data: solid(2, 2, [0, 0, 255, 255]), dispose: 2 },  // blue square
    { w: 1, h: 1, x: 0, y: 0, data: solid(1, 1, [0, 255, 0, 255]) },   // green dot
  ]);
  const { frames, animated } = await loadArt(file);
  assert.ok(animated);
  assert.strictEqual(frames.length, 3);
  const at = (f, x, y) => frames[f].pixels[y * 16 + x];
  assert.strictEqual(at(1, 5, 3), '0000ff');   // square drawn at its offset
  assert.strictEqual(at(1, 0, 0), 'ff0000');   // background kept
  assert.strictEqual(at(2, 5, 3), '000000');   // square disposed to background
  assert.strictEqual(at(2, 0, 0), '00ff00');
  assert.strictEqual(at(2, 15, 15), 'ff0000');
});

test('larger PNGs are scaled down with nearest neighbour', async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    const left = x < 16;
    png.data[i] = left ? 255 : 0;
    png.data[i + 2] = left ? 0 : 255;
    png.data[i + 3] = y === 0 && x === 0 ? 0 : 255;  // one transparent pixel
  }
  const file = path.join(TMP, 'big.png');
  fs.writeFileSync(file, PNG.sync.write(png));
  const { frames, animated } = await loadArt(file);
  assert.ok(!animated);
  assert.strictEqual(frames[0].pixels[0], '000000');        // transparent -> off
  assert.strictEqual(frames[0].pixels[1], 'ff0000');
  assert.strictEqual(frames[0].pixels[8], '0000ff');
  assert.strictEqual(new Set(frames[0].pixels).size, 3);    // no blended colours
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`);
    }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all tests passed');
  process.exit(failed ? 1 : 0);
})();
