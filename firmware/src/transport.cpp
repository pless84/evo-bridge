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
#include <esp_gap_bt_api.h>
#include <esp_mac.h>

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
    if (strlen(EVO_BT_LOCAL_MAC) > 0) {
      uint8_t own[6];
      if (parseMac(EVO_BT_LOCAL_MAC, own) && esp_iface_mac_addr_set(own, ESP_MAC_BT) == ESP_OK)
        Serial.printf("[bt] using Bluetooth address %s\n", EVO_BT_LOCAL_MAC);
      else
        Serial.printf("[bt] could not set Bluetooth address '%s'\n", EVO_BT_LOCAL_MAC);
    }
    // The Evo uses legacy PIN pairing with PIN 0000 (seen in an HCI trace of
    // Linux pairing it). A wrong PIN fails as "authentication failure" and,
    // after a few tries, makes the Evo refuse everyone until power-cycled.
    // Devices that use Secure Simple Pairing instead get a "just works"
    // confirmation, accepted here.
    SerialBT.onConfirmRequest([](uint32_t) { SerialBT.confirmReply(true); });
    SerialBT.onAuthComplete([](boolean ok) {
      Serial.printf("[bt] pairing %s\n", ok ? "succeeded" : "FAILED");
    });
    // master = true (we connect to the Evo); BLE off to save RAM.
    SerialBT.begin(BRIDGE_HOSTNAME, true, true);
    const char* pin = strlen(EVO_PIN) > 0 ? EVO_PIN : "0000";
    SerialBT.setPin(pin, strlen(pin));
    // Present as a computer, like d03n3rfr1tz3/esp32-divoom does; some Divoom
    // devices may refuse an "uncategorized" device.
    esp_bt_cod_t cod = {};
    cod.major = 0b00001;        // computer
    cod.minor = 0b000100;       // handheld
    cod.service = 0b00000010110;
    esp_bt_gap_set_cod(cod, ESP_BT_INIT_COD);
    Serial.printf("[bt] stored pairings: %d\n", SerialBT.getNumberOfBondedDevices());
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
    int channel = 0;  // 0 = let the library look it up
    for (;;) {
      if (!SerialBT.connected(0)) {
        if (channel == 0) {
          // Ask the Evo which RFCOMM channels it offers and log them, so a
          // failed connect can be told apart from a missing service.
          auto chans = SerialBT.getChannels(BTAddress(evoAddr));
          for (const auto& c : chans) {
            Serial.printf("[bt] Evo offers channel %d: %s\n", c.first, c.second.c_str());
            if (channel == 0) channel = c.first;
          }
          if (chans.empty()) Serial.println("[bt] service lookup found no channels");
        }
        Serial.printf("[bt] connecting to %s (channel %d) ...\n", EVO_MAC, channel);
        if (SerialBT.connect(evoAddr, channel, ESP_SPP_SEC_ENCRYPT | ESP_SPP_SEC_AUTHENTICATE)) {
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
