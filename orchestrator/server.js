import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import {
  getDashboardState,
  ingestCrmWebhook,
  ingestInstantlyEvent,
  manualRequeue,
  runPipeline,
  uploadClayCsv,
} from './lib/pipeline.js';
import { ensureDataDirs } from './lib/storage.js';

const PORT = Number(process.env.GTM_ORCHESTRATOR_PORT || 4312);
const PUBLIC_DIR = join(process.cwd(), 'orchestrator', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function serveStatic(req, res) {
  const path = req.url === '/' ? '/index.html' : req.url;
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

async function router(req, res) {
  if (req.url === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, getDashboardState());
    return;
  }
  if (req.url === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await runPipeline({
      fromNode: body.from_node || null,
      dryRun: Boolean(body.dry_run),
      clayInputPath: body.clay_input_path || null,
    });
    sendJson(res, 200, result);
    return;
  }
  if (req.url === '/api/upload-clay' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.filename || !body.content) {
      sendJson(res, 400, { error: 'filename and content are required' });
      return;
    }
    const outPath = uploadClayCsv(body.filename, body.content);
    sendJson(res, 200, { ok: true, file: outPath });
    return;
  }
  if (req.url === '/api/events/instantly' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, await ingestInstantlyEvent(body));
    return;
  }
  if (req.url === '/api/events/manual-requeue' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, await manualRequeue(body));
    return;
  }
  if (req.url === '/api/events/crm-webhook' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, await ingestCrmWebhook(body));
    return;
  }
  serveStatic(req, res);
}

ensureDataDirs();

createServer((req, res) => {
  router(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message });
  });
}).listen(PORT, () => {
  console.log(`GTM orchestrator listening on http://localhost:${PORT}`);
});
