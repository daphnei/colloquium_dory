#!/usr/bin/env python3
"""
Local dev server for Colloquium Dory.
Sends Cross-Origin-Opener-Policy: same-origin-allow-popups so that
Chrome allows the Firebase Google auth popup to communicate back to the page.
Usage: python3 server.py [--port PORT]
"""
import argparse
import http.server
import socketserver

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8000, help='Port to serve on (default: 8000)')
args = parser.parse_args()
PORT = args.port

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress noisy 404s for favicon / devtools
        if '404' not in args[1] if len(args) > 1 else True:
            super().log_message(format, *args)

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
