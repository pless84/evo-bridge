// Request checks for the HTTP API. Plain C++ so it is testable on the PC.
//
// Every endpoint except "/" needs:
//   - X-Evo-Token header equal to BRIDGE_TOKEN (secrets.h)
//   - a Host header naming this bridge (blocks DNS rebinding from web pages)
//   - no Origin header (browsers add one; curl and the hook do not)
#pragma once
#include <string>

namespace evo {

// Constant-time comparison; an empty expected token never matches.
bool tokenMatches(const std::string& given, const std::string& expected);

// host: the request's Host header, with or without ":port".
// Accepts <hostname>, <hostname>.local and the bridge's IP, case-insensitively.
bool hostAllowed(const std::string& host, const std::string& hostname, const std::string& ip);

}  // namespace evo
