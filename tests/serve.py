#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler

class CustomRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

port = 38400

httpd = HTTPServer(('localhost', port), CustomRequestHandler)
print(f'Demo server listening on localhost:{port}...')
httpd.serve_forever()
