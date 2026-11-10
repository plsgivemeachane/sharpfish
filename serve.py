#!/usr/bin/env python3
"""Serve the playable site in site/ on http://localhost:8080.

    python3 serve.py              serve what is already built
    python3 serve.py --build      rebuild the engine first (./make-web.sh)
    python3 serve.py --port 9000  use another port
"""
import argparse
import functools
import http.server
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")


class Handler(http.server.SimpleHTTPRequestHandler):
    # Some Pythons don't know .wasm; browsers need the right type to stream-compile it
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript"}

    def end_headers(self):
        # Always fetch the latest engine after a rebuild
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="Serve the engine's web site")
    ap.add_argument("--build", action="store_true", help="run ./make-web.sh first")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()

    if args.build:
        subprocess.run([os.path.join(ROOT, "make-web.sh")], cwd=ROOT, check=True)

    if not os.path.exists(os.path.join(SITE, "engine-file.js")):
        sys.exit("No engine built yet. Run: python3 serve.py --build")

    handler = functools.partial(Handler, directory=SITE)
    with http.server.ThreadingHTTPServer(("", args.port), handler) as server:
        print(f"Serving on http://localhost:{args.port}  (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
