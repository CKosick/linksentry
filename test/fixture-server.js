/**
 * LinkSentry Deterministic Local Test Server & Fixture Page
 *
 * Serves 22 links covering all specification cases:
 * - 200 OK links
 * - Redirect chain ending at 200
 * - 405 HEAD falling back to 200 GET
 * - 404 Not Found
 * - 410 Gone
 * - 500 & 503 Server Errors
 * - 401, 403, 429 Blocked responses
 * - Route that hangs past timeout
 * - mailto:, tel:, javascript:, data: skipped schemes
 * - Anchor-only '#' and same-page '#section' skipped anchors
 * - Duplicate URL appearing twice (proves deduplication)
 */

import http from 'node:http';

export const FIXTURE_EXPECTATIONS = Object.freeze({
  totalElements: 22,
  goodCount: 8,
  brokenCount: 5,
  blockedCount: 3,
  skippedCount: 6,
  uniqueNetworkUrls: 15
});

/**
 * Creates and starts the fixture server on the specified port.
 * @param {number} [port=8899]
 * @returns {Promise<{ server: http.Server, url: string, close: () => Promise<void> }>}
 */
export function startFixtureServer(port = 8899) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;
      const method = req.method;

      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Fixture HTML page
      if (pathname === '/' || pathname === '/index.html') {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LinkSentry Acceptance Test Fixture</title>
  <style>
    body { font-family: sans-serif; padding: 24px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1 { color: #0f172a; }
    section { margin-bottom: 20px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; }
    a { display: inline-block; margin: 6px 12px 6px 0; color: #2563eb; }
  </style>
</head>
<body>
  <h1>LinkSentry Test Fixture Page</h1>
  <p>Deterministic acceptance testing fixture for LinkSentry Chrome extension.</p>

  <section id="sec-good">
    <h2>Good Links (2xx/3xx)</h2>
    <a href="/link-200-a">Standard 200 A</a>
    <a href="/link-200-b">Standard 200 B</a>
    <a href="/link-200-c">Standard 200 C</a>
    <a href="/link-200-d">Standard 200 D</a>
    <a href="/redirect-1">Redirect Chain (301 -> 302 -> 200)</a>
    <a href="/head-405-fallback">HEAD 405 GET 200 Fallback</a>
    <a href="/link-duplicate">Duplicate URL First Instance</a>
    <a href="/link-duplicate">Duplicate URL Second Instance</a>
  </section>

  <section id="sec-broken">
    <h2>Broken Links (404, 410, 5xx, Timeout)</h2>
    <a href="/link-404">Page Not Found (404)</a>
    <a href="/link-410">Resource Gone (410)</a>
    <a href="/link-500">Internal Server Error (500)</a>
    <a href="/link-503">Service Unavailable (503)</a>
    <a href="/link-hangs">Hanging Route (Timeout)</a>
  </section>

  <section id="sec-blocked">
    <h2>Blocked Links (401, 403, 429)</h2>
    <a href="/link-401">Unauthorized (401)</a>
    <a href="/link-403">Forbidden (403)</a>
    <a href="/link-429">Rate Limited (429)</a>
  </section>

  <section id="sec-skipped">
    <h2>Skipped Links (Non-HTTP & Anchors)</h2>
    <a href="mailto:support@example.com">Contact via Email</a>
    <a href="tel:+15555551212">Call Support</a>
    <a href="javascript:void(0)">JavaScript Trigger</a>
    <a href="data:text/plain;base64,VGVzdA==">Data URL</a>
    <a href="#">Top of Page Anchor</a>
    <a href="#sec-good">Jump to Good Section</a>
  </section>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Route handlers
      if (pathname === '/link-200-a' || pathname === '/link-200-b' || pathname === '/link-200-c' || pathname === '/link-200-d' || pathname === '/link-duplicate') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }

      if (pathname === '/redirect-1') {
        res.writeHead(301, { 'Location': '/redirect-2' });
        res.end();
        return;
      }

      if (pathname === '/redirect-2') {
        res.writeHead(302, { 'Location': '/redirect-final' });
        res.end();
        return;
      }

      if (pathname === '/redirect-final') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Redirect Target Reached');
        return;
      }

      // HEAD rejects with 405 Method Not Allowed; GET succeeds with 200
      if (pathname === '/head-405-fallback') {
        if (method === 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET' });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('GET fallback succeeded');
        }
        return;
      }

      if (pathname === '/link-404') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (pathname === '/link-410') {
        res.writeHead(410, { 'Content-Type': 'text/plain' });
        res.end('Gone');
        return;
      }

      if (pathname === '/link-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      if (pathname === '/link-503') {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
      }

      if (pathname === '/link-401') {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }

      if (pathname === '/link-403') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (pathname === '/link-429') {
        res.writeHead(429, { 'Content-Type': 'text/plain' });
        res.end('Too Many Requests');
        return;
      }

      // Route that hangs past timeout (delayed by 15 seconds)
      if (pathname === '/link-hangs') {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Delayed');
          }
        }, 15000);
        return;
      }

      // Default fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}/`;
      resolve({
        server,
        url,
        close: () => new Promise(cb => server.close(cb))
      });
    });

    server.on('error', reject);
  });
}

// Standalone runner if executed directly
if (process.argv[1] && process.argv[1].endsWith('fixture-server.js')) {
  startFixtureServer(8899).then(({ url }) => {
    console.log(`LinkSentry Test Fixture Server running at ${url}`);
  });
}
