#!/usr/bin/python3
# Bluetooth serial (RFCOMM) pipe for the computer bridge: bytes on stdin go to
# the Evo; replies from the Evo are read and dropped. Exits when the link
# drops, so evo-bridge.js can reconnect.
#
# Uses Fedora's /usr/bin/python3, which has Bluetooth sockets built in (some
# Pythons, e.g. Homebrew's, are compiled without them).
#
#   rfcomm-pipe.py <MAC> [channel]
import os
import socket
import sys
import threading


def log(msg):
    print(f"[rfcomm] {msg}", file=sys.stderr, flush=True)


def main():
    mac = sys.argv[1]
    channel = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    if not hasattr(socket, "BTPROTO_RFCOMM"):
        log(f"{sys.executable} has no Bluetooth support; use /usr/bin/python3")
        return 3
    s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
    s.settimeout(15)
    try:
        s.connect((mac, channel))
    except OSError as e:
        log(f"connect to {mac} channel {channel} failed: {e}")
        return 2
    s.settimeout(None)
    log("connected")
    print("connected", flush=True)  # evo-bridge.js waits for this line

    def drain():
        # Read the Evo's replies (ACKs); an empty read means it hung up.
        try:
            while s.recv(1024):
                pass
        except OSError:
            pass
        log("link closed by the Evo")
        os._exit(1)

    threading.Thread(target=drain, daemon=True).start()
    try:
        while True:
            data = os.read(0, 4096)
            if not data:
                return 0  # bridge closed stdin: shutting down
            s.sendall(data)
    except OSError as e:
        log(f"send failed: {e}")
        return 1
    finally:
        s.close()


if __name__ == "__main__":
    sys.exit(main())
