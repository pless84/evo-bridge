// `node bridge/test-config.js`: settings validation, merging and saving.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-config-'));
process.env.EVO_CONFIG = path.join(tmp, 'sub', 'config.json');
const config = require('./config');

const ok = (c) => assert.deepStrictEqual(config.problems(c), [], JSON.stringify(c));
const bad = (c, re) => assert(config.problems(c).some((p) => re.test(p)), `${JSON.stringify(c)} should fail ${re}`);

ok({});
ok({ mac: '' });
ok({ mac: '11:75:58:74:d2:ad', brightness: 0, timing: { doneHoldMs: 0, idleToClockMs: 86400000 } });
ok({ brightness: null });
bad(null, /object/);
bad([], /object/);
bad({ nope: 1 }, /unknown setting/);
bad({ mac: '11:75:58' }, /mac/);
bad({ mac: 5 }, /mac/);
bad({ brightness: 101 }, /brightness/);
bad({ brightness: 4.5 }, /brightness/);
bad({ brightness: '50' }, /brightness/);
bad({ timing: [] }, /timing must be/);
bad({ timing: { doneHoldMs: -1 } }, /doneHoldMs/);
bad({ timing: { doneHoldMs: 1.5 } }, /doneHoldMs/);
bad({ timing: { doneHoldMs: 86400001 } }, /doneHoldMs/);
bad({ timing: { madeUp: 1 } }, /unknown timing/);
bad({ timing: { sessionTimeoutMs: 0 } }, /sessionTimeoutMs/);   // would drop every session
ok({ timing: { sessionTimeoutMs: 60000, staleBusyMs: 0, idleToClockMs: 0 } });
bad({ constructor: 1 }, /unknown setting/);                     // prototype keys are not settings
bad({ timing: { toString: 5 } }, /unknown timing/);

// merge keeps what isn't mentioned and does not touch the defaults
const m = config.merge(config.DEFAULTS, { timing: { doneHoldMs: 5 } });
assert.strictEqual(m.timing.doneHoldMs, 5);
assert.strictEqual(m.timing.errorHoldMs, config.DEFAULTS.timing.errorHoldMs);
assert.strictEqual(config.DEFAULTS.timing.doneHoldMs, 30000);
assert.strictEqual(config.merge(m, { brightness: 7 }).timing.doneHoldMs, 5);

// load: missing file -> defaults; saved file round-trips (owner-only); broken file -> defaults
assert.deepStrictEqual(config.load(() => {}), config.merge(config.DEFAULTS, {}));
config.save(m);
assert.deepStrictEqual(config.load(() => {}), m);
assert.strictEqual(fs.statSync(config.FILE).mode & 0o777, 0o600);
fs.writeFileSync(config.FILE, '{"brightness": 900}');
let warned = '';
assert.deepStrictEqual(config.load((w) => { warned = w; }), config.merge(config.DEFAULTS, {}));
assert(/brightness/.test(warned));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('all tests passed');
