#!/usr/bin/env bash
# Adds "Evo companion" to the application menu. Run again after moving the repo.
#   companion/install.sh            install the menu entry
#   companion/install.sh --remove   remove it (and the login autostart entry)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
entry="$apps/evo-companion.desktop"
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/evo-companion.desktop"

if [[ "${1:-}" == --remove ]]; then
  rm -f "$entry" "$autostart"
  echo "removed $entry"
  exit 0
fi

/usr/bin/python3 -c 'import PySide6' 2>/dev/null || {
  echo "PySide6 is missing: sudo dnf install python3-pyside6" >&2
  exit 1
}
# Exec needs quoting for paths with spaces etc. (Desktop Entry spec).
q="$(printf '%s' "$here/evo-companion.py" | sed -e 's/[\\"`$]/\\&/g' -e 's/%/%%/g')"
mkdir -p "$apps"
cat > "$entry" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Evo companion
Comment=Status and settings for the Timebox Evo bridge
Exec="$q"
Icon=$here/evo-companion.svg
Terminal=false
Categories=Utility;
StartupWMClass=evo-companion
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" 2>/dev/null || true
echo "installed $entry"
