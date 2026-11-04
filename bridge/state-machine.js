// Decides what the Evo shows from the states reported by any number of Claude
// Code sessions. A port of firmware/src/state_machine.cpp; keep the two in step.
// Time is passed in (ms, monotonic), so it is testable.

const NAMES = ['idle', 'thinking', 'working', 'working_bash', 'working_edit', 'working_read',
  'needs_input', 'done', 'error'];

const isWorking = (s) => s === 'working' || s.startsWith('working_');

// Higher wins when several sessions are active.
function priority(s) {
  if (s === 'needs_input') return 5;
  if (s === 'error') return 4;
  if (isWorking(s)) return 3;
  if (s === 'thinking') return 2;
  if (s === 'done') return 1;
  return 0; // idle, clock
}

// Time since `then`, never negative.
const since = (now, then) => Math.max(0, now - then);

// Ended sessions are kept this long so late, out-of-order events are dropped.
const ENDED_KEEP_MS = 60000;
const MAX_SESSIONS = 8;

const normId = (id) => (id ? String(id) : 'default');

class StateMachine {
  constructor(timing) {
    this.t = timing;
    this.sessions = new Map(); // id -> session
    this.displayed = 'idle';
    this.displayedSince = 0;
    this.allIdle = true;
    this.allIdleSince = 0;
  }

  activeSessions() {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.ended) n++;
    return n;
  }

  add(id, now) {
    if (this.sessions.size >= MAX_SESSIONS) {
      // Full. Drop, in order of preference: an ended session, then the least
      // recently seen session that is not waiting for the user, then anything.
      const score = (s) => (s.ended ? 3 : s.state !== 'needs_input' ? 2 : 1) * 1e15 + since(now, s.lastSeen);
      let worst = null;
      for (const s of this.sessions.values()) if (!worst || score(s) > score(worst)) worst = s;
      this.sessions.delete(worst.id);
    }
    const s = { id, ended: false, state: 'idle', pending: null, since: now, lastSeen: now, lastSeq: 0 };
    this.sessions.set(id, s);
    return s;
  }

  static apply(s, st, now) {
    if (s.state !== st) {
      s.state = st;
      s.since = now;
    }
    s.pending = null;
  }

  // seq: the hook's event time; events older than the newest seen are dropped (0 = unknown).
  report(sessionId, st, now, seq = 0) {
    if (!NAMES.includes(st)) throw new Error(`unknown state ${st}`);
    const id = normId(sessionId);
    let s = this.sessions.get(id);
    if (s && seq && seq < s.lastSeq) return;
    if (s && s.ended) {
      // A newer event after SessionEnd means the id is in use again.
      this.sessions.delete(id);
      s = null;
    }
    if (!s) s = this.add(id, now);
    s.lastSeen = now;
    if (seq) s.lastSeq = seq;
    // Keep a fresh error on screen; anything but a question waits behind it.
    if (s.state === 'error' && st !== 'error' && st !== 'needs_input' && since(now, s.since) < this.t.errorHoldMs) {
      s.pending = st;
      return;
    }
    StateMachine.apply(s, st, now);
  }

  end(sessionId, now, seq = 0) {
    const s = this.sessions.get(normId(sessionId));
    if (!s || (seq && seq < s.lastSeq)) return;
    s.ended = true;
    s.pending = null;
    s.lastSeen = now;
    if (seq) s.lastSeq = seq;
  }

  target(now) {
    let best = 'idle';
    let bestAge = Infinity;
    for (const s of this.sessions.values()) {
      if (s.ended) continue;
      const age = since(now, s.since);
      const p = priority(s.state);
      const bp = priority(best);
      if (p > bp || (p === bp && p > 0 && age < bestAge)) {
        best = s.state;
        bestAge = age;
      }
    }
    return best;
  }

  // Advance timers. Returns true when the displayed state changed.
  tick(now) {
    const t = this.t;
    for (const s of [...this.sessions.values()]) {
      const quiet = since(now, s.lastSeen);
      if (s.ended ? quiet > ENDED_KEEP_MS : quiet > t.sessionTimeoutMs) {
        this.sessions.delete(s.id);
        continue;
      }
      if (s.ended) continue;
      if (s.pending && since(now, s.since) >= t.errorHoldMs) StateMachine.apply(s, s.pending, now);
      if (s.state === 'done' && since(now, s.since) >= t.doneHoldMs) StateMachine.apply(s, 'idle', now);
      if ((s.state === 'thinking' || isWorking(s.state)) && t.staleBusyMs && quiet >= t.staleBusyMs) {
        StateMachine.apply(s, 'idle', now);
      }
    }

    let tgt = this.target(now);
    if (tgt === 'idle') {
      if (!this.allIdle) {
        this.allIdle = true;
        this.allIdleSince = now;
      }
      if (t.idleToClockMs && since(now, this.allIdleSince) >= t.idleToClockMs) tgt = 'clock';
    } else {
      this.allIdle = false;
    }

    if (tgt === this.displayed) return false;
    const shown = since(now, this.displayedSince);
    let allow;
    if (isWorking(tgt) && isWorking(this.displayed)) allow = shown >= t.workingDebounceMs;
    else if (priority(tgt) > priority(this.displayed)) allow = true;
    else allow = shown >= t.minDisplayMs;
    if (!allow) return false;

    this.displayed = tgt;
    this.displayedSince = now;
    return true;
  }
}

module.exports = { StateMachine, NAMES, isWorking, MAX_SESSIONS };
