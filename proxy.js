const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 80;

http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
        res.writeHead(400);
        return res.end('Missing "url" query parameter');
    }

    let parsedTarget;
    try {
        parsedTarget = new URL(target);
    } catch {
        res.writeHead(400);
        return res.end('Invalid URL');
    }

    const lib = parsedTarget.protocol === 'https:' ? https : http;

    lib.get(target, proxyRes => {
        res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, 'Access-Control-Allow-Origin': '*' });
        proxyRes.pipe(res);
    }).on('error', (err) => {
        res.writeHead(502);
        res.end(`Proxy error: ${err.message}`);
    });

}).listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
    console.log(`Usage: http://localhost:${PORT}/?url=http://example.com`);
});
