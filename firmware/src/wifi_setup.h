// Wi-Fi with a setup hotspot, so the network can change without reflashing.
//
// Boot:
//   1. Join the saved network (or WIFI_SSID from secrets.h if none is saved).
//   2. If that fails, or setup was requested, open the hotspot
//      EVO_SETUP_AP_NAME (password SETUP_AP_PASSWORD) with a setup page at
//      http://192.168.4.1. Saving a network there joins it and stores it.
//   3. If nobody finishes setup in EVO_SETUP_PORTAL_TIMEOUT_S, reboot and
//      start over, so a temporary Wi-Fi outage heals by itself.
//
// Setup is requested by holding BOOT during the first seconds after power-on,
// or by wifiRequestSetup() (the POST /wifi/reset endpoint).
#pragma once

// Blocks until connected; restarts the board if no network can be joined.
void wifiSetupBegin();

// Open the setup hotspot on the next boot (keeps the saved network), and reboot.
void wifiRequestSetup();
