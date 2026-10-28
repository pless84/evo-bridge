#include "wifi_setup.h"

#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "config.h"
#include "secrets.h"

#ifndef SETUP_AP_PASSWORD
#error "Add SETUP_AP_PASSWORD to secrets.h (see secrets.h.example)."
#endif
static_assert(sizeof(SETUP_AP_PASSWORD) > 8, "SETUP_AP_PASSWORD needs at least 8 characters (WPA2).");
constexpr bool sameStr(const char* a, const char* b) {
  return *a == *b && (*a == 0 || sameStr(a + 1, b + 1));
}
static_assert(!sameStr(SETUP_AP_PASSWORD, "replace-me-8-plus-chars"),
              "Set SETUP_AP_PASSWORD in secrets.h (it still has the example value).");
#ifndef WIFI_SSID
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#endif

static const char* kPrefs = "evo-wifi";

// Was setup requested over HTTP before the last reboot? Reading clears it.
static bool takeSetupRequest() {
  Preferences p;
  p.begin(kPrefs, false);
  const bool requested = p.getBool("setup", false);
  if (requested) p.remove("setup");
  p.end();
  return requested;
}

// Holding BOOT (GPIO0) for a second during the first seconds after power-on.
// (Holding it *while* powering on or pressing EN starts the flasher instead.)
static bool bootButtonHeld() {
  pinMode(EVO_SETUP_BUTTON_PIN, INPUT_PULLUP);
  Serial.printf("[wifi] hold BOOT now (%u s) to open the setup hotspot\n",
                (unsigned)(EVO_SETUP_BUTTON_WINDOW_MS / 1000));
  const uint32_t start = millis();
  uint32_t heldSince = 0;
  while (millis() - start < EVO_SETUP_BUTTON_WINDOW_MS) {
    if (digitalRead(EVO_SETUP_BUTTON_PIN) == LOW) {
      if (!heldSince) heldSince = millis();
      if (millis() - heldSince >= 1000) return true;
    } else {
      heldSince = 0;
    }
    delay(20);
  }
  return false;
}

static bool waitForWifi(uint32_t ms) {
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < ms) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

static void configure(WiFiManager& wm) {
  wm.setHostname(BRIDGE_HOSTNAME);
  wm.setTitle("Evo bridge");
  wm.setConnectTimeout(20);
  wm.setConnectRetries(2);
  wm.setConfigPortalTimeout(EVO_SETUP_PORTAL_TIMEOUT_S);
  // Only network setup. The default menu also offers a firmware upload page,
  // which would let anyone on the hotspot replace the firmware.
  const char* menu[] = {"wifi", "exit"};
  wm.setMenu(menu, 2);
  wm.setShowInfoErase(false);
  // Hiding menu items does not remove their pages: WiFiManager registers
  // /update and /u (firmware upload), /erase, /info, /restart and /param*
  // regardless. This callback runs before WiFiManager adds its routes, and
  // the web server uses the first matching handler, so these deny handlers
  // win. They have no upload callback, so an uploaded image is discarded.
  wm.setWebServerCallback([&wm]() {
    static const char* const kBlocked[] = {"/update", "/u", "/erase", "/info",
                                           "/restart", "/param", "/paramsave"};
    for (const char* path : kBlocked) {
      wm.server->on(path, [&wm]() { wm.server->send(403, "text/plain", "Not available\n"); });
    }
  });
  wm.setAPCallback([](WiFiManager*) {
    Serial.printf("[wifi] setup hotspot '%s' is open: join it and go to http://192.168.4.1\n",
                  EVO_SETUP_AP_NAME);
  });
}

void wifiSetupBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(BRIDGE_HOSTNAME);
  WiFi.setAutoReconnect(true);

  WiFiManager wm;
  configure(wm);

  const bool forced = takeSetupRequest() || bootButtonHeld();
  bool ok;
  if (forced) {
    Serial.println("[wifi] setup requested");
    ok = wm.startConfigPortal(EVO_SETUP_AP_NAME, SETUP_AP_PASSWORD);
    // Timed out without a new network: fall back to the saved one.
    if (!ok && wm.getWiFiIsSaved()) {
      WiFi.mode(WIFI_STA);
      WiFi.begin();
      ok = waitForWifi(20000);
    }
  } else if (!wm.getWiFiIsSaved() && strlen(WIFI_SSID) > 0) {
    // First boot: use the network from secrets.h; it is saved once joined.
    Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    ok = waitForWifi(20000) || wm.autoConnect(EVO_SETUP_AP_NAME, SETUP_AP_PASSWORD);
  } else {
    ok = wm.autoConnect(EVO_SETUP_AP_NAME, SETUP_AP_PASSWORD);
  }

  if (!ok) {
    Serial.println("[wifi] no network; restarting to try again");
    delay(500);
    ESP.restart();
  }
  Serial.printf("[wifi] %s on %s\n", WiFi.localIP().toString().c_str(), WiFi.SSID().c_str());
}

void wifiRequestSetup() {
  Preferences p;
  p.begin(kPrefs, false);
  p.putBool("setup", true);
  p.end();
  delay(300);
  ESP.restart();
}
