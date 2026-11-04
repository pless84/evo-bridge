// `node bridge/test-state-machine.js`: the firmware's state machine host tests,
// run against the JavaScript port.
const assert = require('assert');
const { StateMachine, MAX_SESSIONS } = require('./state-machine');

const T = {
  minDisplayMs: 800, workingDebounceMs: 1500, errorHoldMs: 3000, doneHoldMs: 30000,
  idleToClockMs: 120000, staleBusyMs: 600000, sessionTimeoutMs: 1800000,
};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sm = () => new StateMachine(T);

test('basic flow, escalation is immediate', () => {
  const m = sm();
  assert(!m.tick(0));
  assert.strictEqual(m.displayed, 'idle');
  m.report('a', 'thinking', 100);
  assert(m.tick(100) && m.displayed === 'thinking');
  m.report('a', 'working_bash', 200);
  assert(m.tick(200) && m.displayed === 'working_bash');
});

test('working variants are debounced', () => {
  const m = sm();
  m.report('a', 'working_bash', 0); m.tick(0);
  m.report('a', 'working_edit', 300);
  assert(!m.tick(300));
  assert(m.tick(1500) && m.displayed === 'working_edit');
});

test('lower priority waits for the minimum display time', () => {
  const m = sm();
  m.report('a', 'working', 0); m.tick(0);
  m.report('a', 'done', 100);
  assert(!m.tick(100));
  assert(m.tick(800) && m.displayed === 'done');
});

test('error is held, then the queued state takes over', () => {
  const m = sm();
  m.report('a', 'error', 0); m.tick(0);
  m.report('a', 'working_read', 50); m.tick(50);
  m.tick(2999);
  assert.strictEqual(m.displayed, 'error');
  assert(m.tick(3000) && m.displayed === 'working_read');
});

test('needs_input cuts through an error hold', () => {
  const m = sm();
  m.report('a', 'error', 0); m.tick(0);
  m.report('a', 'needs_input', 10);
  assert(m.tick(10) && m.displayed === 'needs_input');
});

test('two sessions: busy until both are finished', () => {
  const m = sm();
  m.report('a', 'working', 0); m.report('b', 'working', 0); m.tick(0);
  m.report('a', 'done', 1000); m.tick(5000);
  assert.strictEqual(m.displayed, 'working');
  m.report('b', 'done', 6000); m.tick(7000);
  assert.strictEqual(m.displayed, 'done');
  assert.strictEqual(m.activeSessions(), 2);
});

test('done -> idle -> clock', () => {
  const m = sm();
  m.report('a', 'done', 0); m.tick(0);
  m.tick(30000);
  assert.strictEqual(m.displayed, 'idle');
  m.tick(30000 + 119999);
  assert.strictEqual(m.displayed, 'idle');
  m.tick(30000 + 120000);
  assert.strictEqual(m.displayed, 'clock');
  m.report('a', 'thinking', 200000);
  assert(m.tick(200000) && m.displayed === 'thinking');
});

test('end and timeout remove sessions; empty id is "default"', () => {
  const m = sm();
  m.report('', 'working', 0); m.report('b', 'thinking', 0);
  assert.strictEqual(m.activeSessions(), 2);
  m.end(null, 0);
  assert.strictEqual(m.activeSessions(), 1);
  m.tick(T.sessionTimeoutMs + 1);
  assert.strictEqual(m.activeSessions(), 0);
});

test('full table evicts the least recently seen session', () => {
  const m = sm();
  for (let i = 0; i < 9; i++) m.report(`s${i}`, 'working', i * 10);
  assert.strictEqual(m.activeSessions(), MAX_SESSIONS);
  assert(!m.sessions.has('s0'));
});

test('out-of-order events are dropped', () => {
  const m = sm();
  m.report('a', 'working', 0, 1000);
  m.report('a', 'done', 10, 2000);
  m.report('a', 'working', 20, 1500);
  m.tick(900);
  assert.strictEqual(m.displayed, 'done');
});

test('late events after SessionEnd do not create a ghost', () => {
  const m = sm();
  m.report('a', 'working', 0, 1000);
  m.end('a', 10, 2000);
  m.report('a', 'working', 20, 1500);
  assert.strictEqual(m.activeSessions(), 0);
  m.tick(1000);
  assert.strictEqual(m.displayed, 'idle');
  m.report('a', 'thinking', 30, 3000);
  assert.strictEqual(m.activeSessions(), 1);
  m.tick(70000);
  assert.strictEqual(m.activeSessions(), 1);
});

test('stale working falls back to idle', () => {
  const m = sm();
  m.report('a', 'working_bash', 0); m.tick(0);
  m.tick(T.staleBusyMs - 1);
  assert.strictEqual(m.displayed, 'working_bash');
  m.tick(T.staleBusyMs);
  assert.strictEqual(m.displayed, 'idle');
});

test('eviction keeps a session waiting for the user', () => {
  const m = sm();
  m.report('waiting', 'needs_input', 0);
  for (let i = 0; i < 8; i++) m.report(`s${i}`, 'working', 100 + i);
  assert(m.sessions.has('waiting'));
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `${failed} failed` : 'all tests passed');
process.exit(failed ? 1 : 0);
