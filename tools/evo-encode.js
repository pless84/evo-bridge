// Timebox Evo message encoder. A dependency-free port of the parts of
// RomRider/node-divoom-timebox-evo (v0.3.0) this project uses. Its output is
// checked byte for byte against that library's frozen output by
// `npm test` (test-encoder.js).
//
// Message: 0x01 | len u16 LE | payload | checksum u16 LE | 0x02
//   len      = payload length + 2
//   checksum = sum of the len and payload bytes, mod 65536

const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];

function frame(payload) {
  const body = [...le16(payload.length + 2), ...payload];
  const sum = body.reduce((a, b) => a + b, 0) & 0xffff;
  return Buffer.from([0x01, ...body, ...le16(sum), 0x02]);
}

const rgbBytes = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ---- images ----------------------------------------------------------------

// pixels: 256 RGB hex strings, row-major. Returns the palette in first-seen
// order and the palette index of every pixel.
function palettize(pixels) {
  const colors = [];
  const index = new Map();
  const idx = pixels.map((c) => {
    if (!index.has(c)) {
      index.set(c, colors.length);
      colors.push(c);
    }
    return index.get(c);
  });
  return { colors, idx };
}

// Pixel indices packed LSB-first with just enough bits for the palette.
function packPixels(idx, nColors) {
  const bits = Math.max(1, Math.ceil(Math.log2(nColors)));
  const out = new Array(Math.ceil((idx.length * bits) / 8)).fill(0);
  let pos = 0;
  for (const p of idx) {
    for (let b = 0; b < bits; b++, pos++) {
      if ((p >> b) & 1) out[pos >> 3] |= 1 << (pos & 7);
    }
  }
  return out;
}

// Palette count byte, palette, packed pixels.
function imageBody(pixels) {
  if (pixels.length !== 256) throw new Error(`expected 256 pixels, got ${pixels.length}`);
  const { colors, idx } = palettize(pixels);
  return [colors.length % 256, ...colors.flatMap(rgbBytes), ...packPixels(idx, colors.length)];
}

// One still image -> one message.
function picture(pixels) {
  const body = imageBody(pixels);
  const image = [0xaa, ...le16(body.length + 6), 0x00, 0x00, 0x00, ...body];
  return [frame([0x44, 0x00, 0x0a, 0x0a, 0x04, ...image])];
}

// frames: [{ pixels, ms }] -> messages. All frames are concatenated, then
// sent in 200-byte chunks, each prefixed with 0x49, total size and chunk number.
function animation(frames) {
  const data = frames.flatMap(({ pixels, ms }) => {
    const body = [...le16(ms), 0x00, ...imageBody(pixels)];
    return [0xaa, ...le16(body.length + 3), ...body];
  });
  const msgs = [];
  for (let off = 0, n = 0; off < data.length; off += 200, n++) {
    msgs.push(frame([0x49, ...le16(data.length), n, ...data.slice(off, off + 200)]));
  }
  return msgs;
}

// ---- commands --------------------------------------------------------------

// The Evo's built-in clock channel (full-screen style).
function clock(colorHex = 'ffffff') {
  return [frame([0x45, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, ...rgbBytes(colorHex)])];
}

function brightness(percent) {
  return [frame([0x74, Math.max(0, Math.min(100, Math.trunc(percent)))])];
}

// Scrolling text: init, text, 256-colour palette + background, first frame.
function text(str, fgHex = 'ffffff', bgHex = '000000') {
  const chars = [...str].slice(0, 255).map((c) => {
    const cp = c.codePointAt(0);
    return cp <= 0xffff ? cp : 0x3f; // '?'
  });
  const palette = [];
  for (let i = 0; i < 256; i++) palette.push(...rgbBytes(i < 127 ? bgHex : fgHex));
  return [
    frame([0x6e, 0x01]),
    frame([0x86, 0x01, chars.length, ...chars.flatMap(le16)]),
    frame([0x6c, 0x00, 0x00, 0x07, 0x04, 0xaa, 0x07, 0x04, 0x46, 0x00, 0x00, 0x00,
      ...palette, ...new Array(256).fill(0)]),
    frame([0x6c, 0x01, 0x00, 0x07, 0x01, 0xaa, 0x07, 0x01, 0x43, 0x00, 0x01, 0x00,
      ...new Array(256).fill(0)]),
  ];
}

module.exports = { frame, picture, animation, clock, brightness, text, packPixels };
