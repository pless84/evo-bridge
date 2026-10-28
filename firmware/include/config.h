// Tunables. Override any of these with -D flags in platformio.ini.
#pragma once

// ---- Transport -------------------------------------------------------------
// 0 = Bluetooth Classic SPP to the Evo (Phase 1)
// 1 = wired UART into the Evo's LED board (Phase 2, unverified)
#ifndef EVO_TRANSPORT_UART
#define EVO_TRANSPORT_UART 0
#endif
#ifndef EVO_UART_BAUD
#define EVO_UART_BAUD 115200
#endif
#ifndef EVO_UART_RX_PIN
#define EVO_UART_RX_PIN 16
#endif
#ifndef EVO_UART_TX_PIN
#define EVO_UART_TX_PIN 17
#endif

// Some older Timebox firmware needs bytes 0x01..0x03 inside a message escaped
// as 0x03, b+3. The Evo protocol library does not escape, so this is off.
#ifndef EVO_ESCAPE_PAYLOAD
#define EVO_ESCAPE_PAYLOAD 0
#endif

// ---- Rate limiting ---------------------------------------------------------
// The Evo drops the connection above ~30 messages/s. 60 ms = ~16 msg/s.
#ifndef EVO_MSG_INTERVAL_MS
#define EVO_MSG_INTERVAL_MS 60
#endif

// Bluetooth reconnect backoff.
#ifndef EVO_BT_BACKOFF_MIN_MS
#define EVO_BT_BACKOFF_MIN_MS 2000
#endif
#ifndef EVO_BT_BACKOFF_MAX_MS
#define EVO_BT_BACKOFF_MAX_MS 60000
#endif

// ---- State machine ---------------------------------------------------------
// Minimum time a state stays on screen before a same-or-lower priority state
// replaces it. Higher priority states (e.g. needs_input) always show at once.
#ifndef EVO_MIN_DISPLAY_MS
#define EVO_MIN_DISPLAY_MS 800
#endif
// Switching between working variants (bash/edit/read) waits at least this long,
// so a burst of tool calls does not thrash the display.
#ifndef EVO_WORKING_DEBOUNCE_MS
#define EVO_WORKING_DEBOUNCE_MS 1500
#endif
// An error stays visible at least this long, even if the next tool starts.
#ifndef EVO_ERROR_HOLD_MS
#define EVO_ERROR_HOLD_MS 3000
#endif
// A session shows "done" for this long, then drops back to idle.
#ifndef EVO_DONE_HOLD_MS
#define EVO_DONE_HOLD_MS 30000
#endif
// When every session has been idle this long, show the Evo's clock.
// 0 = never; stay on the idle animation.
#ifndef EVO_IDLE_TO_CLOCK_MS
#define EVO_IDLE_TO_CLOCK_MS 120000
#endif
// A session stuck in thinking/working this long with no events goes idle.
// Interrupting Claude (Esc) sends no Stop event, so this is the cleanup.
#ifndef EVO_STALE_BUSY_MS
#define EVO_STALE_BUSY_MS (10UL * 60UL * 1000UL)
#endif
// Forget sessions that send nothing for this long (crashed or closed Claude).
#ifndef EVO_SESSION_TIMEOUT_MS
#define EVO_SESSION_TIMEOUT_MS (30UL * 60UL * 1000UL)
#endif

// ---- Text ------------------------------------------------------------------
// Scrolling text shows for base + per-char time, then the state comes back.
#ifndef EVO_TEXT_BASE_MS
#define EVO_TEXT_BASE_MS 4000
#endif
#ifndef EVO_TEXT_PER_CHAR_MS
#define EVO_TEXT_PER_CHAR_MS 350
#endif
#ifndef EVO_TEXT_MAX_MS
#define EVO_TEXT_MAX_MS 30000
#endif
