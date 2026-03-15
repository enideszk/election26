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
import urllib.error
import json
import re
import argparse
import threading
from pathlib import Path

# -- Constants --------------------------------------------------------
BASE_2026    = 'https://vtr.valasztas.hu/ogy2026'
BASE_2022    = 'https://vtr.valasztas.hu/ogy2022'
REFRESH_PAGE = BASE_2026 + '/egyeni-valasztokeruletek'

HU_MONTHS = {
    'januar': '01', 'februar': '02', 'marcius': '03', 'aprilis': '04',
    'majus': '05', 'junius': '06', 'julius': '07', 'augusztus': '08',
    'szeptember': '09', 'oktober': '10', 'november': '11', 'december': '12',
    # with accents
    'január': '01', 'február': '02', 'március': '03', 'április': '04',
    'május': '05', 'június': '06', 'július': '07', 'október': '10',
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; ElectionDashboard/1.0)',
    'Accept': '*/*',
}


# -- State object (no globals) ----------------------------------------
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


def detect_date_segment() -> str | None:
    """
    Scrape the 2026 results page and parse the last-update timestamp.
    'Adatok frissitve: 2026. marcius 14. 21:00:00' -> '03142100'
    """
    print(f'[server] Detecting date from {REFRESH_PAGE}')
    try:
        html = fetch_remote(REFRESH_PAGE, accept='text/html').decode('utf-8', errors='replace')
    except Exception as e:
        print(f'[server] WARNING: could not fetch refresh page: {e}')
        return None

    pattern = r'Adatok\s+friss[ií]tve\s*:\s*\d{4}\.\s*(\w+)\s+(\d{1,2})\.\s*(\d{2}):(\d{2}):\d{2}'
    m = re.search(pattern, html, re.IGNORECASE)
    if not m:
        # looser fallback
        m = re.search(r'\d{4}\.\s*(\w+)\s+(\d{1,2})\.\s*(\d{2}):(\d{2}):\d{2}', html)
    if not m:
        print('[server] WARNING: date pattern not found in page')
        return None

    month_hu, day, hour, minute = m.group(1), m.group(2), m.group(3), m.group(4)
    # strip accents for lookup fallback
    month_key = month_hu.lower()
    month = HU_MONTHS.get(month_key)
    if not month:
        print(f'[server] WARNING: unknown month "{month_hu}"')
        return None

    seg = f'{month}{int(day):02d}{hour}{minute}'
    print(f'[server] Date detected: {seg}  (from "{m.group(0).strip()}")')
    return seg


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
        raise ValueError('Eredmenyek URL ismeretlen -- varjon az adatok frissitesere vagy toltse fel kezzel')
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
                # Re-scrape date and bust candidates cache
                if state.year == '2026':
                    new_seg = detect_date_segment()
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

    if state.year == '2026':
        state.date_segment = detect_date_segment()
        if not state.date_segment:
            print('[server] WARNING: date detection failed -- using fallback 03142100')
            state.date_segment = '03142100'
    else:
        state.date_segment = '04161400'

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
