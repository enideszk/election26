#!/usr/bin/env python3
"""
Election night local server
----------------------------
Serves the dashboard and proxies vtr.valasztas.hu server-side.

Usage:
    python server.py                  # 2026 live mode (auto-detects date)
    python server.py --year 2022      # 2022 test mode (fixed URLs)
    python server.py --port 8080      # custom port

Then open: http://localhost:8000

Endpoints:
    /                   -> election-dashboard.html
    /api/jeloltek       -> EgyeniJeloltek.json (candidates, cached)
    /api/eredmenyek     -> results JSON (fresh each request)
    /api/refresh        -> re-scrape date + bust candidates cache
    /api/config         -> current config info
"""

import http.server
import urllib.request
import json
import re
import argparse
import threading
from pathlib import Path

# -- Constants --------------------------------------------------------
BASE_2026 = 'https://vtr.valasztas.hu/ogy2026'
BASE_2022 = 'https://vtr.valasztas.hu/ogy2022'

REFRESH_PAGES = {
    '2026': BASE_2026 + '/egyeni-valasztokeruletek',
    '2022': BASE_2022 + '/egyeni-valasztokeruletek',
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; ElectionDashboard/1.0)',
    'Accept': '*/*',
}


# -- State object -----------------------------------------------------
class AppState:
    def __init__(self, year: str):
        self.year = year
        self.date_segment: str | None = None
        self.candidates_cache: dict | None = None
        self.candidates_lock = threading.Lock()


# -- Helpers ----------------------------------------------------------
def fetch_remote(url: str, accept: str = 'application/json') -> bytes:
    req = urllib.request.Request(url, headers={**HEADERS, 'Accept': accept})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def detect_date_segment(year: str) -> str | None:
    """
    The valasztas.hu site is a React SPA — the 'Adatok frissitve' text is
    rendered client-side and never appears in raw HTML fetched by urllib.

    Instead, the date segment is embedded in the static asset URLs that the
    server bakes into the HTML at build/deploy time, e.g.:
        <script src="/ogy2026/static/js/main.03142100.chunk.js">
    or in API endpoint references like:
        /ogy2026/data/03142100/ver/EgyeniJeloltek.json

    We look for an 8-digit segment in those patterns.
    """
    page = REFRESH_PAGES[year]
    base = '/ogy2026' if year == '2026' else '/ogy2022'
    print(f'[server] Detecting date segment from {page}')

    try:
        html = fetch_remote(page, accept='text/html').decode('utf-8', errors='replace')
    except Exception as e:
        print(f'[server] WARNING: could not fetch page: {e}')
        return None

    # Primary: look for /data/DDDDDDDD/ anywhere in the raw HTML
    m = re.search(r'/data/([0-9]{8})/', html)
    if m:
        seg = m.group(1)
        print(f'[server] Date segment found via /data/ pattern: {seg}')
        return seg

    # Fallback: 8-digit number inside a script/link src under the right base path
    # e.g. /ogy2026/static/js/main.03142100.chunk.js
    m = re.search(re.escape(base) + r'/[^"\']*?([0-9]{8})[^"\'/]*?\.(?:js|json)', html)
    if m:
        seg = m.group(1)
        print(f'[server] Date segment found via script src pattern: {seg}')
        return seg

    print(f'[server] WARNING: no date segment found in HTML')
    print(f'[server] First 800 chars of response:\n{html[:800]}')
    return None


def get_jeloltek_url(state: AppState) -> str:
    if state.year == '2022':
        return f'{BASE_2022}/data/04022333/ver/EgyeniJeloltek.json'
    seg = state.date_segment or '03142100'
    return f'{BASE_2026}/data/{seg}/ver/EgyeniJeloltek.json'


def get_eredmenyek_url(state: AppState) -> str | None:
    if state.year == '2022':
        return f'{BASE_2022}/data/04161400/szavossz/OevkJkv.json'
    if state.date_segment:
        return f'{BASE_2026}/data/{state.date_segment}/szavossz/OevkJkv.json'
    return None


def get_candidates(state: AppState) -> dict:
    with state.candidates_lock:
        if state.candidates_cache is not None:
            return state.candidates_cache
        url = get_jeloltek_url(state)
        print(f'[server] Fetching candidates: {url}')
        data = fetch_remote(url)
        state.candidates_cache = json.loads(data)
        count = len(state.candidates_cache.get('list', []))
        print(f'[server] Candidates cached ({count} entries)')
        return state.candidates_cache


def bust_candidates(state: AppState):
    with state.candidates_lock:
        state.candidates_cache = None


def get_results(state: AppState) -> dict:
    url = get_eredmenyek_url(state)
    if not url:
        raise ValueError('Eredmenyek URL ismeretlen -- toltse fel kezzel vagy varjon')
    print(f'[server] Fetching results: {url}')
    return json.loads(fetch_remote(url))


# -- Request handler --------------------------------------------------
def make_handler(state: AppState):
    class Handler(http.server.BaseHTTPRequestHandler):

        def log_message(self, fmt, *args):
            print(f'[{self.address_string()}] {fmt % args}')

        def send_json(self, obj, status=200):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)

        def serve_file(self, path: Path, content_type: str):
            if not path.exists():
                self.send_response(404)
                self.end_headers()
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?')[0]

            if path in ('/', '/index.html'):
                self.serve_file(
                    Path(__file__).parent / 'election-dashboard.html',
                    'text/html; charset=utf-8'
                )

            elif path == '/api/config':
                self.send_json({
                    'year':           state.year,
                    'date_segment':   state.date_segment,
                    'jeloltek_url':   get_jeloltek_url(state),
                    'eredmenyek_url': get_eredmenyek_url(state),
                    'has_eredmenyek': get_eredmenyek_url(state) is not None,
                    'label':          state.year + (' · ' + state.date_segment if state.date_segment else ' · datum ismeretlen'),
                })

            elif path == '/api/jeloltek':
                try:
                    self.send_json(get_candidates(state))
                except Exception as e:
                    print(f'[server] ERROR jeloltek: {e}')
                    self.send_json({'error': str(e)}, 502)

            elif path == '/api/eredmenyek':
                try:
                    self.send_json(get_results(state))
                except ValueError as e:
                    self.send_json({'error': str(e)}, 404)
                except Exception as e:
                    print(f'[server] ERROR eredmenyek: {e}')
                    self.send_json({'error': str(e)}, 502)

            elif path == '/api/refresh':
                new_seg = detect_date_segment(state.year)
                if new_seg:
                    state.date_segment = new_seg
                bust_candidates(state)
                try:
                    data = get_candidates(state)
                    self.send_json({
                        'ok':           True,
                        'date_segment': state.date_segment,
                        'jeloltek_url': get_jeloltek_url(state),
                        'count':        len(data.get('list', [])),
                    })
                except Exception as e:
                    self.send_json({'error': str(e)}, 502)

            else:
                self.send_response(404)
                self.end_headers()

    return Handler


# -- Main -------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Election night dashboard server')
    parser.add_argument('--year', default='2026', choices=['2022', '2026'])
    parser.add_argument('--port', default=8000, type=int)
    args = parser.parse_args()

    state = AppState(args.year)

    state.date_segment = detect_date_segment(state.year)
    if not state.date_segment:
        fallback = '03142100' if state.year == '2026' else '04161400'
        print(f'[server] WARNING: date detection failed -- using fallback {fallback}')
        state.date_segment = fallback

    print()
    print('  Election Dashboard Server')
    print('  ' + '-' * 50)
    print(f'  Year:       {state.year}')
    print(f'  Date seg:   {state.date_segment}')
    print(f'  Dashboard:  http://localhost:{args.port}')
    print(f'  Jeloltek:   {get_jeloltek_url(state)}')
    print(f'  Eredmenyek: {get_eredmenyek_url(state) or "(drag-and-drop only)"}')
    print(f'  Refresh:    http://localhost:{args.port}/api/refresh')
    print('  ' + '-' * 50)
    print('  Press Ctrl+C to stop')
    print()

    server = http.server.ThreadingHTTPServer(('', args.port), make_handler(state))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[server] Stopped.')


if __name__ == '__main__':
    main()