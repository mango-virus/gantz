#!/usr/bin/env python3
"""
Gantz dev server — static files + /dev/write-back for dev tools.
Replaces 'python -m http.server'; supports POST to write JSON data files.
Usage: python dev-server.py [port]
"""
import http.server, json, os, pathlib, sys

PORT = 8766
ROOT = pathlib.Path(__file__).parent

WRITEABLE = {
    'city-builder': 'assets/data/city-builder.json',
    'collision':    'assets/data/lobby-collision.json',
}

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
            if key not in WRITEABLE:
                raise ValueError(f'unknown key: {key!r}')
            out = ROOT / WRITEABLE[key]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(data, indent=2), encoding='utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            print(f'[dev] wrote {WRITEABLE[key]}')
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
