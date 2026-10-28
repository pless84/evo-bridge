// Decides what the Evo shows, from the states reported by any number of
// Claude Code sessions. Plain C++ (time is passed in) so it is testable on the PC.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace evo {

enum class State : uint8_t {
  Idle,
  Thinking,
  Working,
  WorkingBash,
  WorkingEdit,
  WorkingRead,
  NeedsInput,
  Done,
  Error,
  Clock,  // display only: the Evo's built-in clock
  Count
};

const char* stateName(State s);
// Accepts the names above ("needs_input", "working_bash", ...). "clock" is rejected:
// it is not something a session can be in.
bool parseSessionState(const char* name, State& out);
bool isWorking(State s);

struct Timing {
  uint32_t minDisplayMs;
  uint32_t workingDebounceMs;
  uint32_t errorHoldMs;
  uint32_t doneHoldMs;
  uint32_t idleToClockMs;   // 0 = never
  uint32_t staleBusyMs;     // thinking/working with no events this long -> idle (Esc interrupts send no Stop)
  uint32_t sessionTimeoutMs;
};

struct Session {
  bool used = false;
  bool ended = false;  // SessionEnd seen; kept briefly to drop late events
  char id[41] = {0};
  State state = State::Idle;
  State pending = State::Idle;  // queued behind an error hold
  bool hasPending = false;
  uint32_t since = 0;     // when `state` started
  uint32_t lastSeen = 0;  // last event from this session
  uint64_t lastSeq = 0;   // newest event timestamp from the hook (0 = none)
};

class StateMachine {
 public:
  static const size_t kMaxSessions = 8;

  explicit StateMachine(const Timing& t);

  // A session reported a state. Empty/null id means "default".
  // seq: the hook's event timestamp (ms since epoch); events older than the
  // newest one already seen are dropped, so out-of-order requests are harmless.
  // 0 = unknown, always accepted.
  void report(const char* sessionId, State s, uint32_t now, uint64_t seq = 0);
  // A session ended (Claude Code exited).
  void end(const char* sessionId, uint32_t now, uint64_t seq = 0);

  // Advance timers. Returns true when the displayed state changed.
  bool tick(uint32_t now);

  State displayed() const { return displayed_; }
  uint32_t displayedSince() const { return displayedSince_; }
  const Session* sessions() const { return sessions_; }
  size_t activeSessions() const;

 private:
  Session* find(const char* id);
  Session* findOrAdd(const char* id, uint32_t now);
  void apply(Session& s, State st, uint32_t now);
  State target(uint32_t now) const;

  Timing t_;
  Session sessions_[kMaxSessions];
  State displayed_ = State::Idle;
  uint32_t displayedSince_ = 0;
  bool allIdle_ = true;
  uint32_t allIdleSince_ = 0;
};

}  // namespace evo
