"""Start the standalone demo on this laptop. Standard library only."""
import argparse
import errno
import functools
import http.server
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404, 'Directory listing is disabled')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    if sys.version_info < (3, 10):
        print('Python 3.10 or newer is required. Python 3.12 is recommended.', file=sys.stderr)
        return 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000, help='Local port; 0 chooses a free port')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('--port must be 0..65535')
    static = ROOT/'dist'
    if not (static/'index.html').is_file():
        print('Missing dist/index.html. Extract the whole ZIP before starting.', file=sys.stderr)
        return 1
    handler = functools.partial(LocalHandler, directory=str(static))
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE and getattr(exc, 'winerror', None) != 10048:
            print(f'Cannot start local server: {exc}', file=sys.stderr)
            return 1
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        print(f'Port {args.port} is busy; using a free port.', flush=True)
    url = f'http://127.0.0.1:{server.server_port}/'
    print('NPL Investment Lab v0.9', flush=True)
    print(url, flush=True)
    print('Keep this window open. Stop: Ctrl+C. Data imports stay in the browser.', flush=True)
    if not args.no_browser:
        timer = threading.Timer(.3, webbrowser.open, args=(url,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever(poll_interval=.3)
    except KeyboardInterrupt:
        print('\nStopped.', flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
