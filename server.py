#!/usr/bin/env python3
"""Serve Bot Island Arcade on :4267 (dist/ only; the data is baked in at build time). GET /api/health for a ping."""
import http.server, json, os
R = os.path.dirname(os.path.abspath(__file__)); PORT = int(os.environ.get("BOT_ISLAND_ARCADE_PORT", "4267"))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=os.path.join(R, "dist"), **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            b = json.dumps({"ok": True, "app": "Bot Island Arcade", "port": PORT}).encode(); self.send_response(200)
            self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
