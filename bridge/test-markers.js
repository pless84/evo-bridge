// `node bridge/test-markers.js`: the unread marker pixels.
const assert = require('assert');
const { draw, COLORS } = require('./markers');
const { checkFrame } = require('../tools/build-states');
const encode = require('../tools/evo-encode');

const art = Array(256).fill('123456');

assert.deepStrictEqual(draw(art, []), art);
assert.notStrictEqual(draw(art, []), art, 'always a copy');

const two = draw(art, ['done', 'needs_input']);
assert.deepStrictEqual(two.slice(0, 5), [COLORS.done, '000000', COLORS.needs_input, '000000', '123456']);
assert.deepStrictEqual(two.slice(16), art.slice(16), 'only the top row changes');
assert.strictEqual(art[0], '123456', 'the art itself is untouched');

// eight sessions fill the row; more are not drawn
const many = draw(art, Array(12).fill('error'));
assert.strictEqual(many.length, 256);
assert.deepStrictEqual(many.slice(0, 16), Array(8).fill([COLORS.error, '000000']).flat());
assert.deepStrictEqual(many.slice(16), art.slice(16));

// still encodes to valid messages
encode.animation([{ pixels: two, ms: 100 }]).forEach((m, i) => checkFrame(m, `marked[${i}]`));

console.log('all tests passed');
