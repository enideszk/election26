/**
 * Local file-saving server for the VTR Scraper Tampermonkey script.
 *
 * Usage:
 *   node save-server.js
 *
 * Then visit the target page in your browser — the userscript will POST
 * the scraped text here, and this server overwrites the output file.
 *
 * Change OUTPUT_FILE below to wherever you want the file saved.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──────────────────────────────────────────────
const PORT = 9123;
const OUTPUT_FILE = path.join(__dirname, 'vtr-last-update.txt');
// ────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    // CORS headers so the browser allows the request
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === 'POST' && req.url === '/save') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const content = [
                    `Scraped: ${data.timestamp}`,
                    `Source:  ${data.source}`,
                    '',
                    data.text,
                    ''
                ].join('\n');

                // Overwrite (not append) the file every time
                fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');

                console.log(`[${new Date().toLocaleTimeString()}] Saved: "${data.text}"`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, file: OUTPUT_FILE }));
            } catch (err) {
                console.error('Error:', err.message);
                res.writeHead(400);
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`VTR Save Server listening on http://localhost:${PORT}`);
    console.log(`Output file: ${OUTPUT_FILE}`);
    console.log('Waiting for scraper data...\n');
});
