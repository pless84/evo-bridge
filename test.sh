#!/usr/bin/env bash
# Runs every test suite. Needs `npm install` in tools/ and a C++ compiler.
set -euo pipefail
cd "$(dirname "$0")"
run() { echo "== $*"; "$@"; }
run firmware/test/host/run.sh
(cd tools && run npm test --silent)
run node bridge/test-state-machine.js
run node bridge/test-config.js
run node bridge/test-markers.js
run node bridge/test-art-routes.js
echo "== every suite passed"
