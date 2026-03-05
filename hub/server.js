import { createServer, get as httpGet } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.GTM_HUB_PORT || 4000);
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

// ── Products to probe ──

const PRODUCTS = [
  { id: 'ad-generator',  name: 'Ad Generator',  port: 3001, path: '/' },
  { id: 'flowdrip',      name: 'FlowDrip',      port: 3000, path: '/' },
  { id: 'orchestrator',  name: 'Orchestrator',   port: 4312, path: '/api/state' },
];

// ── Helpers ──

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const path = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = join(PUBLIC_DIR, path);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain; charset=utf-8' });
  res.end(readFileSync(filePath));
}

// ── Health probes ──

function probeService(port, path) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = httpGet({ hostname: 'localhost', port, path, timeout: 2000 }, (res) => {
      res.resume();
      // Any HTTP response means the service process is alive
      resolve({ status: 'online', latencyMs: Date.now() - start });
    });
    req.on('error', () => resolve({ status: 'offline', latencyMs: -1 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'offline', latencyMs: -1 });
    });
  });
}

async function getStatus() {
  const results = await Promise.all(
    PRODUCTS.map(async (p) => {
      const probe = await probeService(p.port, p.path);
      return { id: p.id, name: p.name, port: p.port, ...probe };
    })
  );
  return { products: results };
}

// ── Router ──

async function router(req, res) {
  if (req.url === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, await getStatus());
    return;
  }
  serveStatic(req, res);
}

// ── Start ──

createServer((req, res) => {
  router(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message });
  });
}).listen(PORT, () => {
  console.log(`GTM hub listening on http://localhost:${PORT}`);
});
