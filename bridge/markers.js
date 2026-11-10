// Unread markers: one pixel along the top of the display for each session
// that waits for you, in the colour of what it waits with. Left to right,
// oldest session first, on every other pixel so they can be counted.
const WIDTH = 16;

const COLORS = {
  needs_input: 'ff7a1a', // orange
  error: 'e8333a',       // red
  done: '3ccf5a',        // green
};

// pixels: 256 RGB hex strings, row-major. marks: state names. Returns a copy
// with the markers on the top row; the art between them is switched off so
// they stand apart.
function draw(pixels, marks) {
  const out = pixels.slice();
  marks.slice(0, WIDTH / 2).forEach((m, i) => {
    out[i * 2] = COLORS[m] || 'ffffff';
    out[i * 2 + 1] = '000000';
  });
  return out;
}

module.exports = { draw, COLORS };
