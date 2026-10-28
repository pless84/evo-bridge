#include "protocol.h"

namespace evo {

static void pushLe16(Bytes& b, uint16_t v) {
  b.push_back(v & 0xFF);
  b.push_back(v >> 8);
}

Bytes frame(const uint8_t* payload, size_t n) {
  Bytes out;
  out.reserve(n + 6);
  out.push_back(0x01);
  pushLe16(out, static_cast<uint16_t>(n + 2));
  out.insert(out.end(), payload, payload + n);
  uint32_t sum = 0;
  for (size_t i = 1; i < out.size(); i++) sum += out[i];
  pushLe16(out, static_cast<uint16_t>(sum & 0xFFFF));
  out.push_back(0x02);
  return out;
}

Bytes escape(const uint8_t* msg, size_t n) {
  Bytes out;
  out.reserve(n + 8);
  for (size_t i = 0; i < n; i++) {
    const uint8_t b = msg[i];
    const bool inner = i > 0 && i + 1 < n;
    if (inner && b >= 0x01 && b <= 0x03) {
      out.push_back(0x03);
      out.push_back(b + 0x03);
    } else {
      out.push_back(b);
    }
  }
  return out;
}

Bytes brightness(uint8_t percent) {
  if (percent > 100) percent = 100;
  const uint8_t p[] = {0x74, percent};
  return frame(p, sizeof(p));
}

// Decode UTF-8 into UTF-16 code units (BMP only; anything else becomes '?').
static std::vector<uint16_t> utf16(const std::string& s) {
  std::vector<uint16_t> out;
  size_t i = 0;
  while (i < s.size()) {
    const uint8_t c = s[i];
    uint32_t cp = '?';
    size_t len = 1;
    if (c < 0x80) {
      cp = c;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < s.size()) {
      cp = ((c & 0x1F) << 6) | (s[i + 1] & 0x3F);
      len = 2;
    } else if ((c & 0xF0) == 0xE0 && i + 2 < s.size()) {
      cp = ((c & 0x0F) << 12) | ((s[i + 1] & 0x3F) << 6) | (s[i + 2] & 0x3F);
      len = 3;
    } else if ((c & 0xF8) == 0xF0) {
      len = 4;
    }
    out.push_back(cp <= 0xFFFF ? static_cast<uint16_t>(cp) : '?');
    i += len;
  }
  return out;
}

static void pushRgb(Bytes& b, uint32_t rgb) {
  b.push_back((rgb >> 16) & 0xFF);
  b.push_back((rgb >> 8) & 0xFF);
  b.push_back(rgb & 0xFF);
}

std::vector<Bytes> text(const std::string& utf8, uint32_t fgRgb, uint32_t bgRgb) {
  std::vector<Bytes> msgs;

  // 1. init
  const uint8_t init[] = {0x6E, 0x01};
  msgs.push_back(frame(init, sizeof(init)));

  // 2. the text: 86 01 <count> then each char as u16 LE
  std::vector<uint16_t> chars = utf16(utf8);
  if (chars.size() > 255) chars.resize(255);
  Bytes t = {0x86, 0x01, static_cast<uint8_t>(chars.size())};
  for (uint16_t ch : chars) pushLe16(t, ch);
  msgs.push_back(frame(t.data(), t.size()));

  // 3. palette (256 colours) + background pixel indices (all 0).
  // Indices 0..126 are the background colour, 127..255 the text colour.
  Bytes pal = {0x6C, 0x00, 0x00, 0x07, 0x04, 0xAA, 0x07, 0x04, 0x46, 0x00, 0x00, 0x00};
  pal.reserve(pal.size() + 256 * 3 + 256);
  for (int i = 0; i < 256; i++) pushRgb(pal, i < 127 ? bgRgb : fgRgb);
  pal.insert(pal.end(), 256, 0x00);
  msgs.push_back(frame(pal.data(), pal.size()));

  // 4. first background animation frame (frame number 1, static background)
  Bytes f = {0x6C, 0x01, 0x00, 0x07, 0x01, 0xAA, 0x07, 0x01, 0x43, 0x00, 0x01, 0x00};
  f.insert(f.end(), 256, 0x00);
  msgs.push_back(frame(f.data(), f.size()));

  return msgs;
}

}  // namespace evo
