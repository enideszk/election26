#!/usr/bin/env python3
"""
Election night local server
----------------------------
Serves the dashboard and proxies vtr.valasztas.hu server-side.

Usage:
    python server.py                  # 2026 live mode
    python server.py --year 2022      # 2022 test mode (fixed URLs)
    python server.py --port 8080      # custom port

Then open: http://localhost:8000

Endpoints:
    /                   -> election-dashboard.html
    /api/jeloltek       -> EgyeniJeloltek.json (candidates, cached)
    /api/eredmenyek     -> results JSON (fresh each request)
    /api/refresh        -> re-read date from localhost:9123 + bust candidates cache
    /api/config         -> current config info

Date segment is read from http://localhost:9123/vtr-last-update.txt (line 4).
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

VTR_UPDATE_FILE = Path(__file__).parent / 'vtr-last-update.txt'

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


HU_MONTHS = {
    'január': 1, 'február': 2, 'március': 3, 'április': 4,
    'május': 5, 'június': 6, 'július': 7, 'augusztus': 8,
    'szeptember': 9, 'október': 10, 'november': 11, 'december': 12,
}


def parse_hu_date(text: str) -> str | None:
    """Parse 'Adatok frissítve: 2026. március 15. 01:00:00' -> 'MMDDHHmm'."""
    m = re.search(r'(\w+)\s+(\d{1,2})\.\s+(\d{2}):(\d{2}):\d{2}', text)
    if not m:
        return None
    month_name, day, hour, minute = m.group(1), m.group(2), m.group(3), m.group(4)
    month = HU_MONTHS.get(month_name.lower())
    if not month:
        return None
    return f'{month:02d}{int(day):02d}{hour}{minute}'


def read_date_segment() -> str | None:
    """Read and parse the date segment from line 4 of vtr-last-update.txt."""
    print(f'[server] Reading date segment from {VTR_UPDATE_FILE}')
    try:
        lines = VTR_UPDATE_FILE.read_text(encoding='utf-8', errors='replace').splitlines()
        if len(lines) < 4:
            print(f'[server] WARNING: vtr-last-update.txt has fewer than 4 lines')
            return None
        line4 = lines[3].strip()
        seg = parse_hu_date(line4)
        if seg:
            print(f'[server] Date segment from vtr-last-update.txt: {seg} (from: {line4!r})')
            return seg
        print(f'[server] WARNING: could not parse date from line 4: {line4!r}')
        return None
    except Exception as e:
        print(f'[server] WARNING: could not read vtr-last-update.txt: {e}')
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
                new_seg = read_date_segment()
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


# -- Background poller ------------------------------------------------
def start_date_poller(state: AppState, interval: int = 5):
    """Poll vtr-last-update.txt every `interval` seconds; update state when it changes."""
    import time

    def poll():
        while True:
            time.sleep(interval)
            seg = read_date_segment()
            if seg and seg != state.date_segment:
                print(f'[poller] Date segment changed: {state.date_segment} -> {seg}')
                state.date_segment = seg
                bust_candidates(state)

    t = threading.Thread(target=poll, daemon=True)
    t.start()


# -- Main -------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Election night dashboard server')
    parser.add_argument('--year', default='2026', choices=['2022', '2026'])
    parser.add_argument('--port', default=8000, type=int)
    args = parser.parse_args()

    state = AppState(args.year)

    state.date_segment = read_date_segment()
    if not state.date_segment:
        fallback = '03142100' if state.year == '2026' else '04161400'
        print(f'[server] WARNING: date detection failed -- using fallback {fallback}')
        state.date_segment = fallback

    start_date_poller(state)

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