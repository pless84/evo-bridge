// How bytes reach the Evo. Phase 1 uses Bluetooth Classic SPP; Phase 2 may
// replace it with a wired UART tap. Everything above this layer is the same.
#pragma once
#include <Arduino.h>

class Transport {
 public:
  virtual ~Transport() {}
  virtual void begin() = 0;
  virtual void loop() {}
  virtual bool connected() = 0;
  virtual size_t write(const uint8_t* data, size_t len) = 0;
  virtual const char* name() const = 0;
};

// Returns the transport selected by EVO_TRANSPORT_UART (config.h).
Transport& makeTransport();
