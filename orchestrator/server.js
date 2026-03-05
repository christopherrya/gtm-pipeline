import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import {
  getDashboardState,
  ingestCrmWebhook,
  ingestInstantlyEvent,
  manualRequeue,
  runPipeline,
  uploadClayCsv,
} from './lib/pipeline.js';
import { ensureDataDirs } from './lib/storage.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.GTM_ORCHESTRATOR_PORT || 4312);
const PUBLIC_DIR = join(__dirname, 'public');

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

  // --- GTM Outreach Review Queue API ---
  const supabaseUrl = process.env.SUPABASE_GTM_URL;
  const supabaseKey = process.env.SUPABASE_GTM_SERVICE_KEY;

  if (req.url === '/api/review-queue' && req.method === 'GET') {
    if (!supabaseUrl || !supabaseKey) {
      sendJson(res, 500, { error: 'SUPABASE_GTM_URL / SUPABASE_GTM_SERVICE_KEY not set' });
      return;
    }
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/gtm_review_queue?select=*,gtm_outreach_campaigns(agent_name,agent_email,listing_address)&order=created_at.desc`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    sendJson(res, resp.ok ? 200 : 502, await resp.json());
    return;
  }

  if (req.url?.startsWith('/api/review-queue/') && req.method === 'POST') {
    if (!supabaseUrl || !supabaseKey) {
      sendJson(res, 500, { error: 'SUPABASE_GTM_URL / SUPABASE_GTM_SERVICE_KEY not set' });
      return;
    }
    const parts = req.url.split('/');
    const reviewId = parts[3]; // /api/review-queue/{id}/{action}
    const action = parts[4];
    const body = await readBody(req);

    if (action === 'approve') {
      // Update review queue status to approved
      await fetch(
        `${supabaseUrl}/rest/v1/gtm_review_queue?id=eq.${reviewId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
            draft_email_subject: body.subject || undefined,
            draft_email_body: body.body || undefined,
          }),
        }
      );
      // Trigger the send-findings-email edge function
      const sendResp = await fetch(`${supabaseUrl}/functions/v1/send-findings-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ review_queue_id: reviewId }),
      });
      sendJson(res, sendResp.ok ? 200 : 502, await sendResp.json());
      return;
    }

    if (action === 'reject') {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/gtm_review_queue?id=eq.${reviewId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            reviewer_notes: body.notes || '',
          }),
        }
      );
      sendJson(res, resp.ok ? 200 : 502, { ok: true });
      return;
    }

    sendJson(res, 400, { error: `Unknown action: ${action}` });
    return;
  }

  if (req.url === '/api/campaigns' && req.method === 'GET') {
    if (!supabaseUrl || !supabaseKey) {
      sendJson(res, 500, { error: 'SUPABASE_GTM_URL / SUPABASE_GTM_SERVICE_KEY not set' });
      return;
    }
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/gtm_outreach_campaigns?select=id,agent_name,agent_email,listing_address,status,created_at&order=created_at.desc&limit=100`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    sendJson(res, resp.ok ? 200 : 502, await resp.json());
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
