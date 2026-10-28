// Evo bridge: HTTP over Wi-Fi in, Timebox Evo messages out.
//
//   GET  /state/<name>?session_id=<id>&t=<ms>
//        name: idle | thinking | working[_bash|_edit|_read] | needs_input | done | error | end
//        t: hook event time; events older than the newest seen for a session are dropped
//   POST /text                           body = text (or form field text=), ?color=RRGGBB
//   GET  /brightness/<0-100>
//   GET  /status                         JSON
//
// Everything except "/" needs the X-Evo-Token header (BRIDGE_TOKEN in secrets.h),
// a Host header naming this bridge, and no Origin header. See auth.h.
#include <Arduino.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>

#include "config.h"
#include "auth.h"
#include "protocol.h"
#include "secrets.h"
#include "sender.h"
#include "state_machine.h"
#include "states.h"
#include "transport.h"

using evo::State;

constexpr bool sameStr(const char* a, const char* b) {
  return *a == *b && (*a == 0 || sameStr(a + 1, b + 1));
}
static_assert(!sameStr(BRIDGE_TOKEN, "replace-with-openssl-rand-hex-16"),
              "Set BRIDGE_TOKEN in secrets.h (it still has the example value).");
static_assert(sizeof(BRIDGE_TOKEN) > 16,
              "Set BRIDGE_TOKEN in secrets.h to a random string of at least 16 characters "
              "(e.g. `openssl rand -hex 16`).");

static WebServer server(80);
static Transport& transport = makeTransport();
static Sender sender(transport, EVO_MSG_INTERVAL_MS, EVO_ESCAPE_PAYLOAD);
static evo::StateMachine machine({EVO_MIN_DISPLAY_MS, EVO_WORKING_DEBOUNCE_MS, EVO_ERROR_HOLD_MS,
                                  EVO_DONE_HOLD_MS, EVO_IDLE_TO_CLOCK_MS, EVO_STALE_BUSY_MS,
                                  EVO_SESSION_TIMEOUT_MS});

// What is on screen right now: a state animation, or text on top of it.
static std::vector<evo::Bytes> textMsgs;
static String textShown;
static uint32_t textUntil = 0;
static bool textActive = false;
static bool wasConnected = false;
static int brightness = -1;  // last value set over HTTP; re-sent on reconnect

// ---------------------------------------------------------------------------

static std::vector<evo::Bytes> stateMessages(State s) {
  std::vector<evo::Bytes> out;
  const char* name = evo::stateName(s);
  for (size_t i = 0; i < EVO_STATE_COUNT; i++) {
    if (strcmp(EVO_STATES[i].name, name) != 0) continue;
    for (uint8_t m = 0; m < EVO_STATES[i].count; m++) {
      const EvoMessage& msg = EVO_STATES[i].messages[m];
      out.emplace_back(msg.data, msg.data + msg.len);
    }
    return out;
  }
  // No art for this state (e.g. custom build without a variant): fall back.
  if (evo::isWorking(s) && s != State::Working) return stateMessages(State::Working);
  return out;
}

static void showCurrent() {
  if (textActive)
    sender.replace(textMsgs);
  else
    sender.replace(stateMessages(machine.displayed()));
}

// Strictly a decimal number 0..max, or -1.
static long parseUint(const String& s, long max) {
  if (s.isEmpty() || s.length() > 15) return -1;
  for (size_t i = 0; i < s.length(); i++)
    if (!isdigit(static_cast<unsigned char>(s[i]))) return -1;
  const unsigned long long v = strtoull(s.c_str(), nullptr, 10);
  return v <= static_cast<unsigned long long>(max) ? static_cast<long>(v) : -1;
}

// Session ids come from the hook; keep them short and printable.
static String cleanId(const String& raw) {
  String out;
  for (size_t i = 0; i < raw.length() && out.length() < 40; i++) {
    const char c = raw[i];
    if (isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_') out += c;
  }
  return out;
}

static String jsonEscape(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    const char c = s[i];
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (static_cast<unsigned char>(c) < 0x20) {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP

// Sends the error response and returns false if the request is not allowed.
static bool authorized() {
  if (server.hasHeader("Origin")) {
    server.send(403, "text/plain", "browser requests are not allowed\n");
    return false;
  }
  if (!evo::hostAllowed(server.hostHeader().c_str(), BRIDGE_HOSTNAME,
                        WiFi.localIP().toString().c_str())) {
    server.send(403, "text/plain", "wrong Host\n");
    return false;
  }
  if (!evo::tokenMatches(server.header("X-Evo-Token").c_str(), BRIDGE_TOKEN)) {
    server.send(401, "text/plain", "missing or wrong X-Evo-Token\n");
    return false;
  }
  return true;
}

static void handleState(String name) {
  if (name.endsWith("/")) name.remove(name.length() - 1);
  const String sid = cleanId(server.arg("session_id"));
  const uint64_t seq = strtoull(server.arg("t").c_str(), nullptr, 10);
  const uint32_t now = millis();
  if (name == "end") {
    machine.end(sid.c_str(), now, seq);
  } else {
    State s;
    if (!evo::parseSessionState(name.c_str(), s)) {
      server.send(404, "text/plain", "unknown state: " + name + "\n");
      return;
    }
    machine.report(sid.c_str(), s, now, seq);
  }
  if (machine.tick(now) && !textActive) showCurrent();
  server.send(200, "text/plain", String("ok ") + evo::stateName(machine.displayed()) + "\n");
}

static uint32_t parseColor(const String& hex, uint32_t fallback) {
  String h = hex;
  if (h.startsWith("#")) h = h.substring(1);
  if (h.length() != 6) return fallback;
  char* end = nullptr;
  const uint32_t v = strtoul(h.c_str(), &end, 16);
  return (end && *end == 0) ? v : fallback;
}

static void handleText() {
  String text = server.hasArg("text") ? server.arg("text") : server.arg("plain");
  if (text.isEmpty()) {
    // `curl --data 'hello'` sends a form body, which the server parses as an
    // argument named "hello" with no value. Take that name as the text.
    for (int i = 0; i < server.args(); i++) {
      if (server.argName(i) != "color" && server.argName(i) != "plain" && server.arg(i).isEmpty()) {
        text = server.argName(i);
        break;
      }
    }
  }
  text.trim();
  if (text.isEmpty()) {
    server.send(400, "text/plain", "empty text\n");
    return;
  }
  const uint32_t color = parseColor(server.arg("color"), 0xFFFFFF);
  textMsgs = evo::text(std::string(text.c_str()), color, 0x000000);
  textShown = text;
  textActive = true;
  textUntil = millis() + min<uint32_t>(EVO_TEXT_BASE_MS + EVO_TEXT_PER_CHAR_MS * text.length(),
                                       EVO_TEXT_MAX_MS);
  showCurrent();
  server.send(200, "text/plain", "ok\n");
}

static void handleBrightness(String value) {
  if (value.endsWith("/")) value.remove(value.length() - 1);
  const long v = parseUint(value, 100);
  if (v < 0) {
    server.send(400, "text/plain", "brightness must be 0-100\n");
    return;
  }
  brightness = v;
  // Goes out ahead of anything queued, through the same pacing and escaping.
  sender.sendNext(evo::brightness(static_cast<uint8_t>(v)));
  server.send(200, "text/plain", "ok\n");
}

static void handleStatus() {
  const uint32_t now = millis();
  String j = "{";
  j += "\"transport\":\"" + String(transport.name()) + "\",";
  j += "\"connected\":" + String(transport.connected() ? "true" : "false") + ",";
  j += "\"state\":\"" + String(evo::stateName(machine.displayed())) + "\",";
  j += "\"state_for_s\":" + String((now - machine.displayedSince()) / 1000) + ",";
  j += "\"text\":" + (textActive ? "\"" + jsonEscape(textShown) + "\"" : String("null")) + ",";
  j += "\"queued\":" + String(sender.queued()) + ",";
  j += "\"sent\":" + String(sender.sent()) + ",";
  j += "\"brightness\":" + (brightness < 0 ? String("null") : String(brightness)) + ",";
  j += "\"uptime_s\":" + String(now / 1000) + ",";
  j += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  j += "\"sessions\":[";
  bool first = true;
  for (size_t i = 0; i < evo::StateMachine::kMaxSessions; i++) {
    const evo::Session& s = machine.sessions()[i];
    if (!s.used || s.ended) continue;
    if (!first) j += ",";
    first = false;
    j += "{\"id\":\"" + jsonEscape(s.id) + "\",\"state\":\"" + evo::stateName(s.state) +
         "\",\"idle_s\":" + String((now - s.lastSeen) / 1000) + "}";
  }
  j += "]}\n";
  server.send(200, "application/json", j);
}

static void handleOther() {
  if (!authorized()) return;
  const String uri = server.uri();
  if (uri.startsWith("/state/")) return handleState(uri.substring(7));
  if (uri.startsWith("/brightness/")) return handleBrightness(uri.substring(12));
  server.send(404, "text/plain", "not found\n");
}

static void handleRoot() {
  server.send(200, "text/plain",
              "Evo bridge\n"
              "  GET  /state/<idle|thinking|working|working_bash|working_edit|working_read|"
              "needs_input|done|error|end>?session_id=ID\n"
              "  POST /text   (body = text, ?color=RRGGBB)\n"
              "  GET  /brightness/<0-100>\n"
              "  GET  /status\n");
}

// ---------------------------------------------------------------------------

static void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(BRIDGE_HOSTNAME);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("[wifi] not connected yet; will keep retrying");
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[evo-bridge] starting");

  startWifi();
  if (MDNS.begin(BRIDGE_HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("[mdns] http://%s.local\n", BRIDGE_HOSTNAME);
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/status", HTTP_GET, [] {
    if (authorized()) handleStatus();
  });
  server.on("/text", HTTP_POST, [] {
    if (authorized()) handleText();
  });
  static const char* kHeaders[] = {"X-Evo-Token", "Origin"};
  server.collectHeaders(kHeaders, 2);
  server.onNotFound(handleOther);
  server.begin();

  transport.begin();
  Serial.printf("[evo] transport: %s\n", transport.name());
}

void loop() {
  server.handleClient();
  transport.loop();
  // Read the clock after the handlers ran: they store millis() too, and a
  // `now` from before them would be in their past.
  const uint32_t now = millis();

  // (Re)connected: the Evo shows whatever it had, so send our screen again.
  const bool connected = transport.connected();
  if (connected && !wasConnected) {
    showCurrent();
    if (brightness >= 0) sender.sendNext(evo::brightness(static_cast<uint8_t>(brightness)));
  }
  wasConnected = connected;

  if (textActive && static_cast<int32_t>(now - textUntil) >= 0) {
    textActive = false;
    showCurrent();
  }
  if (machine.tick(now) && !textActive) showCurrent();

  sender.loop(now);
  delay(2);
}
