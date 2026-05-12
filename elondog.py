"""Tiny launcher: serves elondog.html on http://localhost:8000 and opens it."""
from __future__ import annotations

import http.server
import os
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path

PORT = 8000
PAGE = "elondog.html"


def main() -> int:
    root = Path(__file__).resolve().parent
    os.chdir(root)

    if not (root / PAGE).exists():
        print(f"[!] {PAGE} not found in {root}", file=sys.stderr)
        return 1

    handler = http.server.SimpleHTTPRequestHandler

    class QuietHandler(handler):
        def log_message(self, format, *args):
            return

    with socketserver.TCPServer(("127.0.0.1", PORT), QuietHandler) as httpd:
        url = f"http://localhost:{PORT}/{PAGE}"
        print(f"Serving {root} at {url}")
        print("Press Ctrl+C to stop.")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
