// Rate-limited outbox. Replacing the content drops anything still queued, so a
// fast run of state changes only ever sends the newest one.
#pragma once
#include <vector>

#include "protocol.h"
#include "transport.h"

class Sender {
 public:
  Sender(Transport& t, uint32_t intervalMs, bool escape)
      : t_(t), interval_(intervalMs), escape_(escape) {}

  // Replace the queue with these messages (already framed).
  void replace(std::vector<evo::Bytes> msgs);
  // Send this message next, ahead of whatever is queued (e.g. brightness).
  void sendNext(evo::Bytes msg);
  void loop(uint32_t now);
  size_t queued() const { return queue_.size() - next_; }
  uint32_t sent() const { return sent_; }

 private:
  Transport& t_;
  uint32_t interval_;
  bool escape_;
  std::vector<evo::Bytes> queue_;
  size_t next_ = 0;
  uint32_t lastSend_ = 0;
  uint32_t sent_ = 0;
};
