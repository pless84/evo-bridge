// Timebox Evo wire format helpers. Plain C++ so it can be unit-tested on the PC.
//
// Message: 0x01 | len (u16 LE) | payload | checksum (u16 LE) | 0x02
//   len      = payload length + 2
//   checksum = sum of the len bytes and payload bytes, mod 65536
// Reference: RomRider/node-divoom-timebox-evo (TimeboxEvoMessage, DisplayText).
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>

namespace evo {

using Bytes = std::vector<uint8_t>;

Bytes frame(const uint8_t* payload, size_t n);

// Escape 0x01/0x02/0x03 between the start and end bytes as 0x03, b+3.
// Only needed for older firmware (see EVO_ESCAPE_PAYLOAD).
Bytes escape(const uint8_t* msg, size_t n);

Bytes brightness(uint8_t percent);

// Scrolling text, as 4 framed messages. The Evo scrolls it by itself.
// Text is UTF-8; it is sent as UTF-16 code units and capped at 255 of them.
std::vector<Bytes> text(const std::string& utf8, uint32_t fgRgb = 0xFFFFFF, uint32_t bgRgb = 0x000000);

}  // namespace evo
