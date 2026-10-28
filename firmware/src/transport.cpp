#include "transport.h"

#include "config.h"
#include "secrets.h"

#if EVO_TRANSPORT_UART

class UartTransport : public Transport {
 public:
  void begin() override {
    Serial2.begin(EVO_UART_BAUD, SERIAL_8N1, EVO_UART_RX_PIN, EVO_UART_TX_PIN);
  }
  void loop() override {
    while (Serial2.available()) Serial2.read();  // ignore replies for now
  }
  bool connected() override { return true; }
  size_t write(const uint8_t* d, size_t n) override { return Serial2.write(d, n); }
  const char* name() const override { return "uart"; }
};

Transport& makeTransport() {
  static UartTransport t;
  return t;
}

#else  // Bluetooth Classic SPP

#include <BluetoothSerial.h>

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error "Bluetooth Classic is not enabled. Use an original ESP32 (not C3/S2/S3)."
#endif

static BluetoothSerial SerialBT;
static uint8_t evoAddr[6];

static bool parseMac(const char* s, uint8_t out[6]) {
  unsigned v[6];
  if (sscanf(s, "%x:%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
  for (int i = 0; i < 6; i++) out[i] = static_cast<uint8_t>(v[i]);
  return true;
}

class BtTransport : public Transport {
 public:
  void begin() override {
    if (!parseMac(EVO_MAC, evoAddr)) {
      Serial.printf("[bt] EVO_MAC '%s' is not a valid MAC address\n", EVO_MAC);
      return;
    }
    // master = true (we connect to the Evo); BLE off to save RAM.
    SerialBT.begin(BRIDGE_HOSTNAME, true, true);
    if (strlen(EVO_PIN) > 0) SerialBT.setPin(EVO_PIN, strlen(EVO_PIN));
    // connect() blocks for seconds, so it runs in its own task and never
    // stalls the HTTP server.
    xTaskCreatePinnedToCore(connectTask, "evo-bt", 4096, nullptr, 1, nullptr, 0);
  }

  void loop() override {
    while (SerialBT.available()) SerialBT.read();  // drop Evo replies
  }

  bool connected() override { return SerialBT.connected(0); }

  size_t write(const uint8_t* d, size_t n) override { return SerialBT.write(d, n); }

  const char* name() const override { return "bluetooth"; }

 private:
  static void connectTask(void*) {
    uint32_t backoff = EVO_BT_BACKOFF_MIN_MS;
    for (;;) {
      if (!SerialBT.connected(0)) {
        Serial.printf("[bt] connecting to %s ...\n", EVO_MAC);
        if (SerialBT.connect(evoAddr)) {
          Serial.println("[bt] connected");
          backoff = EVO_BT_BACKOFF_MIN_MS;
        } else {
          Serial.printf("[bt] failed, retry in %lu ms\n", (unsigned long)backoff);
          SerialBT.disconnect();
          vTaskDelay(pdMS_TO_TICKS(backoff));
          backoff = min<uint32_t>(backoff * 2, EVO_BT_BACKOFF_MAX_MS);
          continue;
        }
      }
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }
};

Transport& makeTransport() {
  static BtTransport t;
  return t;
}

#endif
