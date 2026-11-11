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

test('unread: done stays unread after it fades to idle, until the session moves on', () => {
  const m = sm();
  m.report('a', 'working', 0); m.tick(0);
  assert.deepStrictEqual(m.unread(), []);
  m.report('a', 'done', 1000); m.tick(1000);
  assert.deepStrictEqual(m.unread(), ['done']);
  m.tick(1000 + T.doneHoldMs);
  assert.strictEqual(m.displayed, 'idle');
  assert.deepStrictEqual(m.unread(), ['done']);
  m.report('a', 'thinking', 50000);
  assert.deepStrictEqual(m.unread(), []);
});

test('unread: one entry per waiting session, oldest session first; end clears', () => {
  const m = sm();
  m.report('a', 'working', 0); m.report('b', 'working', 0); m.report('c', 'working', 0);
  m.report('c', 'needs_input', 10); m.report('a', 'done', 20);
  assert.deepStrictEqual(m.unread(), ['done', 'needs_input']);
  m.report('c', 'working_bash', 30); // answered
  assert.deepStrictEqual(m.unread(), ['done']);
  m.report('b', 'error', 40);
  assert.deepStrictEqual(m.unread(), ['done', 'error']);
  m.report('b', 'working', 50); // queued behind the error hold
  assert.deepStrictEqual(m.unread(), ['done', 'error']);
  m.tick(40 + T.errorHoldMs);
  assert.deepStrictEqual(m.unread(), ['done']);
  m.end('a', 5000);
  assert.deepStrictEqual(m.unread(), []);
});

test('clearUnread forgets finished sessions, not ones that still wait', () => {
  const m = sm();
  m.report('a', 'done', 0); m.report('b', 'needs_input', 0); m.report('c', 'error', 0);
  m.report('d', 'done', 0); m.tick(T.doneHoldMs);
  assert.deepStrictEqual(m.unread(), ['done', 'needs_input', 'error', 'done']);
  m.clearUnread();
  assert.deepStrictEqual(m.unread(), ['needs_input', 'error']);
  m.report('a', 'done', T.doneHoldMs + 10); // finishing again is unread again
  assert.deepStrictEqual(m.unread(), ['done', 'needs_input', 'error']);
});

test('label names a live session', () => {
  const m = sm();
  m.report('a', 'working', 0);
  m.label('a', 'my-project'); m.label('a', ''); m.label('nope', 'x');
  assert.strictEqual(m.sessions.get('a').name, 'my-project');
  assert.strictEqual(m.sessions.size, 1);
});

test('wake: from the clock back to the idle pet, and the clock waits again', () => {
  const m = sm();
  m.tick(0);
  assert(m.tick(120000) && m.displayed === 'clock');
  assert(m.wake(130000) && m.displayed === 'idle');
  assert(!m.tick(249999) && m.displayed === 'idle');
  assert(m.tick(250000) && m.displayed === 'clock');
});

test('wake: does nothing while a session is busy', () => {
  const m = sm();
  m.report('a', 'working', 0); m.tick(0);
  assert(!m.wake(100) && m.displayed === 'working');
});

test('dismiss: a question goes back to idle at once, without its marker', () => {
  const m = sm();
  m.report('a', 'needs_input', 0); m.tick(0);
  assert.strictEqual(m.dismiss(100), 1);
  assert.strictEqual(m.displayed, 'idle'); // no minimum display time
  assert.strictEqual(m.sessions.get('a').state, 'idle');
  assert.deepStrictEqual(m.unread(), []);
  assert(!m.tick(T.idleToClockMs + 99) && m.tick(T.idleToClockMs + 100) && m.displayed === 'clock');
});

test('dismiss: one session; the other keeps waiting and stays on screen', () => {
  const m = sm();
  m.report('a', 'error', 0);
  m.report('b', 'needs_input', 10); m.tick(10);
  assert.strictEqual(m.dismiss(100, 'b'), 1);
  assert.strictEqual(m.displayed, 'error');
  assert.deepStrictEqual(m.unread(), ['error']);
  assert.strictEqual(m.dismiss(200, 'nope'), 0);
});

test('dismiss: an error moves on to the state queued behind it', () => {
  const m = sm();
  m.report('a', 'error', 0); m.tick(0);
  m.report('a', 'working', 500); // held behind the error
  m.dismiss(600);
  assert.strictEqual(m.sessions.get('a').state, 'working');
  assert.strictEqual(m.displayed, 'working');
});

test('dismiss: busy sessions are left alone; a faded done marker is cleared', () => {
  const m = sm();
  m.report('a', 'done', 0);
  m.tick(T.doneHoldMs); // a: idle, still unread
  m.report('b', 'working', T.doneHoldMs); m.tick(T.doneHoldMs);
  assert.strictEqual(m.dismiss(T.doneHoldMs + 100), 1);
  assert.deepStrictEqual(m.unread(), []);
  assert.strictEqual(m.sessions.get('b').state, 'working');
  assert.strictEqual(m.displayed, 'working');
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
