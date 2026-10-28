#!/usr/bin/env bash
# Builds and runs the PC-side firmware tests (no ESP32 needed).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
# Sanitizers if this machine has them (SANITIZE=0 to skip).
SAN=""
if [[ "${SANITIZE:-1}" == 1 ]] && echo 'int main(){}' | c++ -x c++ -fsanitize=address,undefined -o build/.probe - 2>/dev/null; then
  SAN="-fsanitize=address,undefined"
fi
c++ -std=c++17 -Wall -Wextra -Werror -O1 $SAN \
  -o build/tests test_main.cpp ../../src/protocol.cpp ../../src/state_machine.cpp
./build/tests
