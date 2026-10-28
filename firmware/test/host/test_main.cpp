// PC-side tests for the parts of the firmware that do not need hardware.
// Run: firmware/test/host/run.sh
#include <stdio.h>
#include <string.h>

#include "../../include/states.h"
#include "../../src/auth.h"
#include "../../src/protocol.h"
#include "../../src/state_machine.h"
#include "fixtures.h"

using evo::State;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);     \
      failures++;                                                  \
    }                                                              \
  } while (0)

static bool same(const evo::Bytes& a, const uint8_t* b, size_t n) {
  return a.size() == n && memcmp(a.data(), b, n) == 0;
}

static void testProtocol() {
  printf("protocol\n");
  // Text encoder matches node-divoom-timebox-evo byte for byte.
  auto msgs = evo::text(FIX_TEXT);
  CHECK(msgs.size() == FIX_TEXT_COUNT);
  for (size_t i = 0; i < msgs.size() && i < FIX_TEXT_COUNT; i++)
    CHECK(same(msgs[i], FIX_TEXT_MSGS[i], FIX_TEXT_LENS[i]));

  CHECK(same(evo::brightness(50), FIX_BRIGHTNESS_50, sizeof(FIX_BRIGHTNESS_50)));

  // Re-framing the payload of every generated state message reproduces it.
  for (size_t s = 0; s < EVO_STATE_COUNT; s++) {
    for (uint8_t m = 0; m < EVO_STATES[s].count; m++) {
      const EvoMessage& msg = EVO_STATES[s].messages[m];
      auto again = evo::frame(msg.data + 3, msg.len - 6);
      CHECK(same(again, msg.data, msg.len));
    }
  }

  // Escaping leaves start/end alone and expands 01/02/03 inside.
  const uint8_t raw[] = {0x01, 0x05, 0x01, 0x02, 0x03, 0x04, 0x02};
  const uint8_t esc[] = {0x01, 0x05, 0x03, 0x04, 0x03, 0x05, 0x03, 0x06, 0x04, 0x02};
  CHECK(same(evo::escape(raw, sizeof(raw)), esc, sizeof(esc)));

  // UTF-8 is sent as UTF-16 code units: "é" -> e9 00
  auto u = evo::text("\xC3\xA9");
  CHECK(u[1][3] == 0x86 && u[1][5] == 1 && u[1][6] == 0xE9 && u[1][7] == 0x00);
}

static const evo::Timing T = {800, 1500, 3000, 30000, 120000, 10 * 60 * 1000, 30 * 60 * 1000};

static void testStateMachine() {
  printf("state machine\n");
  {  // basic flow, escalation is immediate
    evo::StateMachine m(T);
    CHECK(!m.tick(0));
    CHECK(m.displayed() == State::Idle);
    m.report("a", State::Thinking, 100);
    CHECK(m.tick(100) && m.displayed() == State::Thinking);
    m.report("a", State::WorkingBash, 200);
    CHECK(m.tick(200) && m.displayed() == State::WorkingBash);
  }
  {  // working variants are debounced
    evo::StateMachine m(T);
    m.report("a", State::WorkingBash, 0);
    m.tick(0);
    m.report("a", State::WorkingEdit, 300);
    CHECK(!m.tick(300));
    CHECK(m.displayed() == State::WorkingBash);
    CHECK(m.tick(1500) && m.displayed() == State::WorkingEdit);
  }
  {  // a lower-priority state waits for the minimum display time
    evo::StateMachine m(T);
    m.report("a", State::Working, 0);
    m.tick(0);
    m.report("a", State::Done, 100);
    CHECK(!m.tick(100));
    CHECK(m.tick(800) && m.displayed() == State::Done);
  }
  {  // error is held, then the queued state takes over
    evo::StateMachine m(T);
    m.report("a", State::Error, 0);
    m.tick(0);
    m.report("a", State::WorkingRead, 50);
    m.tick(50);
    CHECK(m.displayed() == State::Error);
    m.tick(2999);
    CHECK(m.displayed() == State::Error);
    CHECK(m.tick(3000) && m.displayed() == State::WorkingRead);
  }
  {  // needs_input cuts through an error hold
    evo::StateMachine m(T);
    m.report("a", State::Error, 0);
    m.tick(0);
    m.report("a", State::NeedsInput, 10);
    CHECK(m.tick(10) && m.displayed() == State::NeedsInput);
  }
  {  // two sessions: busy until both are finished
    evo::StateMachine m(T);
    m.report("a", State::Working, 0);
    m.report("b", State::Working, 0);
    m.tick(0);
    m.report("a", State::Done, 1000);
    m.tick(5000);
    CHECK(m.displayed() == State::Working);
    m.report("b", State::Done, 6000);
    m.tick(7000);
    CHECK(m.displayed() == State::Done);
    CHECK(m.activeSessions() == 2);
  }
  {  // done -> idle -> clock
    evo::StateMachine m(T);
    m.report("a", State::Done, 0);
    m.tick(0);
    m.tick(30000);
    CHECK(m.displayed() == State::Idle);
    m.tick(30000 + 119999);
    CHECK(m.displayed() == State::Idle);
    m.tick(30000 + 120000);
    CHECK(m.displayed() == State::Clock);
    m.report("a", State::Thinking, 200000);
    CHECK(m.tick(200000) && m.displayed() == State::Thinking);
  }
  {  // end and timeout remove sessions; empty id is "default"
    evo::StateMachine m(T);
    m.report("", State::Working, 0);
    m.report("b", State::Thinking, 0);
    CHECK(m.activeSessions() == 2);
    m.end(nullptr, 0);
    CHECK(m.activeSessions() == 1);
    m.tick(T.sessionTimeoutMs + 1);
    CHECK(m.activeSessions() == 0);
  }
  {  // full table evicts the least recently seen session
    evo::StateMachine m(T);
    char id[16];
    for (int i = 0; i < 9; i++) {
      snprintf(id, sizeof(id), "s%d", i);
      m.report(id, State::Working, i * 10);
    }
    CHECK(m.activeSessions() == evo::StateMachine::kMaxSessions);
    bool hasS0 = false;
    for (size_t i = 0; i < evo::StateMachine::kMaxSessions; i++)
      if (strcmp(m.sessions()[i].id, "s0") == 0) hasS0 = true;
    CHECK(!hasS0);
  }
  {  // millis() wrap-around
    evo::StateMachine m(T);
    const uint32_t t0 = 0xFFFFFF00u;
    m.report("a", State::Working, t0);
    m.tick(t0);
    m.report("a", State::Done, t0 + 10);
    CHECK(m.tick(t0 + 900) && m.displayed() == State::Done);
  }
  {  // a handler stored a time later than the loop's `now` (review finding)
    evo::StateMachine m(T);
    m.report("a", State::Working, 1005);
    CHECK(m.tick(1000) && m.displayed() == State::Working);
    CHECK(m.activeSessions() == 1);
    m.report("a", State::Done, 1100);
    CHECK(!m.tick(1050));  // min display time still applies
    CHECK(m.displayed() == State::Working);
    CHECK(m.tick(1900) && m.displayed() == State::Done);
  }
  {  // out-of-order events are dropped by sequence number
    evo::StateMachine m(T);
    m.report("a", State::Working, 0, 1000);
    m.report("a", State::Done, 10, 2000);
    m.report("a", State::Working, 20, 1500);  // late PostToolUse
    m.tick(900);
    CHECK(m.displayed() == State::Done);
  }
  {  // late events after SessionEnd do not create a ghost session
    evo::StateMachine m(T);
    m.report("a", State::Working, 0, 1000);
    m.end("a", 10, 2000);
    m.report("a", State::Working, 20, 1500);
    CHECK(m.activeSessions() == 0);
    m.tick(1000);
    CHECK(m.displayed() == State::Idle);
    m.report("a", State::Thinking, 30, 3000);  // genuinely newer: id reused
    CHECK(m.activeSessions() == 1);
    m.tick(70000);
    CHECK(m.activeSessions() == 1);
  }
  {  // interrupted turn: stale working falls back to idle
    evo::StateMachine m(T);
    m.report("a", State::WorkingBash, 0);
    m.tick(0);
    m.tick(T.staleBusyMs - 1);
    CHECK(m.displayed() == State::WorkingBash);
    m.tick(T.staleBusyMs);
    CHECK(m.displayed() == State::Idle);
    CHECK(m.activeSessions() == 1);
  }
  {  // eviction keeps a session that is waiting for the user
    evo::StateMachine m(T);
    m.report("waiting", State::NeedsInput, 0);
    char id[16];
    for (int i = 0; i < 8; i++) {
      snprintf(id, sizeof(id), "s%d", i);
      m.report(id, State::Working, 100 + i);
    }
    bool kept = false;
    for (size_t i = 0; i < evo::StateMachine::kMaxSessions; i++)
      if (strcmp(m.sessions()[i].id, "waiting") == 0 && m.sessions()[i].used) kept = true;
    CHECK(kept);
  }
  {  // state names round-trip; clock cannot be reported
    State s;
    CHECK(evo::parseSessionState("needs_input", s) && s == State::NeedsInput);
    CHECK(evo::parseSessionState("working_edit", s) && s == State::WorkingEdit);
    CHECK(!evo::parseSessionState("clock", s));
    CHECK(!evo::parseSessionState("bogus", s));
    for (int i = 0; i < static_cast<int>(State::Count); i++) {
      bool found = false;
      for (size_t k = 0; k < EVO_STATE_COUNT; k++)
        if (strcmp(EVO_STATES[k].name, evo::stateName(static_cast<State>(i))) == 0) found = true;
      CHECK(found);  // every state has art
    }
  }
}

static void testAuth() {
  printf("auth\n");
  CHECK(evo::tokenMatches("abcdef0123456789", "abcdef0123456789"));
  CHECK(!evo::tokenMatches("abcdef0123456788", "abcdef0123456789"));
  CHECK(!evo::tokenMatches("abcdef012345678", "abcdef0123456789"));    // prefix
  CHECK(!evo::tokenMatches("abcdef01234567890", "abcdef0123456789"));  // longer
  CHECK(!evo::tokenMatches("", "abcdef0123456789"));
  CHECK(!evo::tokenMatches("", ""));  // no token configured never matches

  const char* ip = "192.168.1.50";
  CHECK(evo::hostAllowed("evo.local", "evo", ip));
  CHECK(evo::hostAllowed("EVO.local:80", "evo", ip));
  CHECK(evo::hostAllowed("evo.local.", "evo", ip));
  CHECK(evo::hostAllowed("evo", "evo", ip));
  CHECK(evo::hostAllowed("192.168.1.50", "evo", ip));
  CHECK(evo::hostAllowed("192.168.1.50:80", "evo", ip));
  CHECK(!evo::hostAllowed("attacker.example", "evo", ip));  // DNS rebinding
  CHECK(!evo::hostAllowed("evo.local.attacker.example", "evo", ip));
  CHECK(!evo::hostAllowed("evo.local:8080", "evo", ip));
  CHECK(!evo::hostAllowed("192.168.1.5", "evo", ip));
  CHECK(!evo::hostAllowed("", "evo", ip));
  CHECK(!evo::hostAllowed(":80", "evo", ip));
}

int main() {
  testAuth();
  testProtocol();
  testStateMachine();
  if (failures) {
    printf("%d check(s) failed\n", failures);
    return 1;
  }
  printf("all tests passed\n");
  return 0;
}
