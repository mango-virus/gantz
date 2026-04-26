#!/usr/bin/env python3
"""
Gantz dev server — static files + /dev/write-back for dev tools.
Replaces 'python -m http.server'; supports POST to write JSON data files.
Usage: python dev-server.py [port]
"""
import http.server, json, os, pathlib, re, sys

PORT = 8766
ROOT = pathlib.Path(__file__).parent

WRITEABLE = {
    'city-builder': 'assets/data/city-builder.json',
    'collision':    'assets/data/lobby-collision.json',
}

# Per-level edit files written by the level editor (level.html). Keys take
# the form `level-edit:<levelId>` where `<levelId>` matches an entry in
# src/content/levelRegistry.js. We allow lowercase letters, digits, hyphens,
# and underscores in the id — anything else is rejected to keep the path
# strictly inside assets/data/level-edits/.
LEVEL_EDIT_KEY = re.compile(r'^level-edit:([a-z0-9_-]+)$')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != '/dev/write-back':
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
            key    = body.get('key', '')
            data   = body.get('data')
            if key in WRITEABLE:
                rel = WRITEABLE[key]
            else:
                m = LEVEL_EDIT_KEY.match(key)
                if not m:
                    raise ValueError(f'unknown key: {key!r}')
                rel = f'assets/data/level-edits/{m.group(1)}.json'
            out = ROOT / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(data, indent=2), encoding='utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            print(f'[dev] wrote {rel}')
        except Exception as exc:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        pass  # suppress per-request logs; write-back prints its own

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    with http.server.HTTPServer(('', port), Handler) as srv:
        print(f'Gantz dev server → http://localhost:{port}/')
        srv.serve_forever()
