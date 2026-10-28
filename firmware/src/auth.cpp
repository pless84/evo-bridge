#include "auth.h"

#include <ctype.h>

namespace evo {

bool tokenMatches(const std::string& given, const std::string& expected) {
  if (expected.empty()) return false;
  // Compare every byte of the expected token regardless of where the first
  // difference is, so timing does not reveal a matching prefix.
  unsigned diff = given.size() ^ expected.size();
  for (size_t i = 0; i < expected.size(); i++) {
    const unsigned char g = i < given.size() ? given[i] : 0;
    diff |= g ^ static_cast<unsigned char>(expected[i]);
  }
  return diff == 0;
}

static std::string lower(std::string s) {
  for (char& c : s) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return s;
}

bool hostAllowed(const std::string& rawHost, const std::string& hostname, const std::string& ip) {
  std::string host = lower(rawHost);
  const size_t colon = host.rfind(':');
  if (colon != std::string::npos) {
    const std::string port = host.substr(colon + 1);
    if (port != "80") return false;  // the bridge only listens on 80
    host = host.substr(0, colon);
  }
  if (!host.empty() && host.back() == '.') host.pop_back();  // "evo.local."
  if (host.empty()) return false;
  const std::string name = lower(hostname);
  return host == name || host == name + ".local" || (!ip.empty() && host == ip);
}

}  // namespace evo
