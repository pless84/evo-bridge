#include "sender.h"

void Sender::replace(std::vector<evo::Bytes> msgs) {
  queue_ = std::move(msgs);
  next_ = 0;
}

void Sender::sendNext(evo::Bytes msg) {
  queue_.insert(queue_.begin() + next_, std::move(msg));
}

void Sender::loop(uint32_t now) {
  if (next_ >= queue_.size() || !t_.connected()) return;
  if (now - lastSend_ < interval_) return;
  const evo::Bytes& m = queue_[next_];
  size_t want, wrote;
  if (escape_) {
    evo::Bytes e = evo::escape(m.data(), m.size());
    want = e.size();
    wrote = t_.write(e.data(), e.size());
  } else {
    want = m.size();
    wrote = t_.write(m.data(), m.size());
  }
  lastSend_ = now;
  // Nothing went out (TX queue full / link dropping): retry this message on
  // the next slot. A partial write cannot be resumed cleanly, so move on.
  if (wrote == 0 && want > 0) return;
  next_++;
  sent_++;
  if (next_ >= queue_.size()) {
    queue_.clear();
    next_ = 0;
  }
}
