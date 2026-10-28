#include "state_machine.h"

#include <string.h>

namespace evo {

namespace {

struct NameEntry {
  State state;
  const char* name;
};

const NameEntry kNames[] = {
    {State::Idle, "idle"},
    {State::Thinking, "thinking"},
    {State::Working, "working"},
    {State::WorkingBash, "working_bash"},
    {State::WorkingEdit, "working_edit"},
    {State::WorkingRead, "working_read"},
    {State::NeedsInput, "needs_input"},
    {State::Done, "done"},
    {State::Error, "error"},
    {State::Clock, "clock"},
};

// Higher wins when several sessions are active.
int priority(State s) {
  switch (s) {
    case State::NeedsInput: return 5;
    case State::Error: return 4;
    case State::Working:
    case State::WorkingBash:
    case State::WorkingEdit:
    case State::WorkingRead: return 3;
    case State::Thinking: return 2;
    case State::Done: return 1;
    default: return 0;  // Idle, Clock
  }
}

// Time since `then`, wrap-safe, and 0 if `then` is (slightly) after `now`
// (a handler may have stored a later millis() than the caller's `now`).
uint32_t since(uint32_t now, uint32_t then) {
  const int32_t d = static_cast<int32_t>(now - then);
  return d > 0 ? static_cast<uint32_t>(d) : 0;
}

// Ended sessions are kept this long so late, out-of-order events are dropped.
const uint32_t kEndedKeepMs = 60000;

}  // namespace

const char* stateName(State s) {
  for (const auto& e : kNames)
    if (e.state == s) return e.name;
  return "?";
}

bool parseSessionState(const char* name, State& out) {
  if (!name) return false;
  for (const auto& e : kNames) {
    if (e.state != State::Clock && strcmp(e.name, name) == 0) {
      out = e.state;
      return true;
    }
  }
  return false;
}

bool isWorking(State s) {
  return s == State::Working || s == State::WorkingBash || s == State::WorkingEdit ||
         s == State::WorkingRead;
}

StateMachine::StateMachine(const Timing& t) : t_(t) {}

size_t StateMachine::activeSessions() const {
  size_t n = 0;
  for (const auto& s : sessions_)
    if (s.used && !s.ended) n++;
  return n;
}

static const char* normId(const char* id) { return (id && *id) ? id : "default"; }

Session* StateMachine::find(const char* id) {
  id = normId(id);
  for (auto& s : sessions_)
    if (s.used && strncmp(s.id, id, sizeof(s.id) - 1) == 0) return &s;
  return nullptr;
}

Session* StateMachine::findOrAdd(const char* id, uint32_t now) {
  if (Session* s = find(id)) return s;
  Session* slot = nullptr;
  for (auto& s : sessions_) {
    if (!s.used) {
      slot = &s;
      break;
    }
  }
  if (!slot) {
    // Full. Reuse, in order of preference: an ended session, then the least
    // recently seen session that is not waiting for the user, then anything.
    auto score = [&](const Session& s) -> uint64_t {
      const uint64_t age = since(now, s.lastSeen);
      if (s.ended) return (3ULL << 32) + age;
      if (s.state != State::NeedsInput) return (2ULL << 32) + age;
      return age;
    };
    slot = &sessions_[0];
    for (auto& s : sessions_)
      if (score(s) > score(*slot)) slot = &s;
  }
  *slot = Session();
  slot->used = true;
  strncpy(slot->id, normId(id), sizeof(slot->id) - 1);
  slot->since = now;
  slot->lastSeen = now;
  return slot;
}

void StateMachine::apply(Session& s, State st, uint32_t now) {
  if (s.state != st) {
    s.state = st;
    s.since = now;
  }
  s.hasPending = false;
}

void StateMachine::report(const char* sessionId, State st, uint32_t now, uint64_t seq) {
  Session* s = find(sessionId);
  if (s && seq && seq < s->lastSeq) return;  // older than what we already have
  if (s && s->ended) {
    // A newer event after SessionEnd means the id is in use again.
    *s = Session();
    s = nullptr;
  }
  if (!s) s = findOrAdd(sessionId, now);
  s->lastSeen = now;
  if (seq) s->lastSeq = seq;
  // Keep a fresh error on screen; anything but a question waits behind it.
  if (s->state == State::Error && st != State::Error && st != State::NeedsInput &&
      since(now, s->since) < t_.errorHoldMs) {
    s->pending = st;
    s->hasPending = true;
    return;
  }
  apply(*s, st, now);
}

void StateMachine::end(const char* sessionId, uint32_t now, uint64_t seq) {
  Session* s = find(sessionId);
  if (!s) return;
  if (seq && seq < s->lastSeq) return;
  s->ended = true;
  s->hasPending = false;
  s->lastSeen = now;
  if (seq) s->lastSeq = seq;
}

State StateMachine::target(uint32_t now) const {
  State best = State::Idle;
  uint32_t bestAge = UINT32_MAX;
  for (const auto& s : sessions_) {
    if (!s.used || s.ended) continue;
    const uint32_t age = since(now, s.since);
    const int p = priority(s.state), bp = priority(best);
    if (p > bp || (p == bp && p > 0 && age < bestAge)) {
      best = s.state;
      bestAge = age;
    }
  }
  return best;
}

bool StateMachine::tick(uint32_t now) {
  for (auto& s : sessions_) {
    if (!s.used) continue;
    const uint32_t quiet = since(now, s.lastSeen);
    if (s.ended ? quiet > kEndedKeepMs : quiet > t_.sessionTimeoutMs) {
      s.used = false;
      continue;
    }
    if (s.ended) continue;
    if (s.hasPending && since(now, s.since) >= t_.errorHoldMs) apply(s, s.pending, now);
    if (s.state == State::Done && since(now, s.since) >= t_.doneHoldMs) apply(s, State::Idle, now);
    if ((s.state == State::Thinking || isWorking(s.state)) && t_.staleBusyMs &&
        quiet >= t_.staleBusyMs)
      apply(s, State::Idle, now);
  }

  State tgt = target(now);
  if (tgt == State::Idle) {
    if (!allIdle_) {
      allIdle_ = true;
      allIdleSince_ = now;
    }
    if (t_.idleToClockMs && since(now, allIdleSince_) >= t_.idleToClockMs) tgt = State::Clock;
  } else {
    allIdle_ = false;
  }

  if (tgt == displayed_) return false;

  const uint32_t shown = since(now, displayedSince_);
  bool allow;
  if (isWorking(tgt) && isWorking(displayed_))
    allow = shown >= t_.workingDebounceMs;
  else if (priority(tgt) > priority(displayed_))
    allow = true;
  else
    allow = shown >= t_.minDisplayMs;
  if (!allow) return false;

  displayed_ = tgt;
  displayedSince_ = now;
  return true;
}

}  // namespace evo
