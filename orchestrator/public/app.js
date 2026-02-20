const paletteEl = document.getElementById('palette');
const canvasEl = document.getElementById('canvas');
const inspectorEl = document.getElementById('inspector');
const runsEl = document.getElementById('runs');
const statsEl = document.getElementById('stats');
const fromNodeEl = document.getElementById('from-node');
const topMetricsEl = document.getElementById('top-metrics');

let state = null;
let selectedNode = null;
let selectedRunId = null;

const palette = {
  Source: ['N01_ClayUploadIngest', 'N02_BrokerageScrape'],
  Transform: ['N03_NormalizeRecords', 'N04_DedupeListings'],
  Match: ['N05_ContactJoin'],
  Decision: ['N06_TriggerScoring', 'N07_ABVariantAssignment', 'N08_SuppressionFilter'],
  Sink: ['N09_TriggerQueueExport', 'N10_CrmUpsert', 'N11_InstantlyPush', 'N12_RunReports'],
  Event: ['E01_InstantlyEventIngest', 'E02_ManualRequeue', 'E03_CrmWebhookIngest'],
};

const nodeTypeByPrefix = {
  N01: 'source',
  N02: 'source',
  N03: 'transform',
  N04: 'transform',
  N05: 'match',
  N06: 'decision',
  N07: 'decision',
  N08: 'decision',
  N09: 'sink',
  N10: 'sink',
  N11: 'sink',
  N12: 'sink',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function renderPalette() {
  paletteEl.innerHTML = '';
  Object.entries(palette).forEach(([group, nodes]) => {
    const groupLi = document.createElement('li');
    groupLi.className = 'palette-group';
    const chips = nodes
      .map((n) => `<span class="chip">${n.replace('_', ' ')}</span>`)
      .join('');
    groupLi.innerHTML = `<div class="palette-title">${group}</div><div class="palette-chips">${chips}</div>`;
    paletteEl.appendChild(groupLi);
  });
}

function latestNodeStatus(nodeId) {
  if (!state?.runs?.length) return { status: 'idle', detail: 'No runs yet' };
  const latest = state.runs[0];
  const n = latest.nodes?.find((x) => x.node_id === nodeId);
  if (!n) return { status: 'idle', detail: latest.status };
  return { status: n.status || 'idle', detail: n.error || n.status };
}

function renderCanvas() {
  canvasEl.innerHTML = '';
  (state.nodes || []).forEach((nodeId, idx) => {
    const card = document.createElement('div');
    const prefix = nodeId.split('_')[0];
    const type = nodeTypeByPrefix[prefix] || 'event';
    card.className = `node node-${type}`;
    const st = latestNodeStatus(nodeId);
    card.innerHTML = `
      <div>
        <strong>${nodeId}</strong>
        <div class="meta">Edge ${idx < state.nodes.length - 1 ? `${nodeId} -> ${state.nodes[idx + 1]}` : 'Terminal'}</div>
      </div>
      <span class="status ${st.status}">${st.status}</span>
    `;
    card.onclick = () => {
      selectedNode = nodeId;
      inspectorEl.textContent = JSON.stringify(
        {
          node: nodeId,
          latest_status: st.status,
          detail: st.detail,
          contracts: 'I/O contracts and policies are implemented in orchestrator/lib/pipeline.js',
        },
        null,
        2
      );
    };
    canvasEl.appendChild(card);
  });
}

function renderRuns() {
  runsEl.innerHTML = '';
  (state.runs || []).forEach((run) => {
    const li = document.createElement('li');
    if (run.run_id === selectedRunId) li.classList.add('active');
    li.innerHTML = `
      <div>
        <div><strong>${run.run_id}</strong></div>
        <div class="meta">${new Date(run.started_at).toLocaleString()}</div>
      </div>
      <span class="status ${run.status}">${run.status}</span>
    `;
    li.onclick = () => {
      selectedRunId = run.run_id;
      const nodeSummary = (run.nodes || []).map((n) => ({
        node: n.node_id,
        status: n.status,
        started_at: n.started_at,
        ended_at: n.ended_at || null,
        error: n.error || null,
        report_file: n.report_file || null,
      }));
      inspectorEl.textContent = JSON.stringify(
        {
          run_id: run.run_id,
          status: run.status,
          started_at: run.started_at,
          ended_at: run.ended_at || null,
          from_node: run.from_node || 'N01_ClayUploadIngest',
          dry_run: run.dry_run,
          nodes: nodeSummary,
        },
        null,
        2
      );
      renderRuns();
    };
    runsEl.appendChild(li);
  });
}

function renderStats() {
  statsEl.innerHTML = `
    <div>CRM mirror contacts: <strong>${state.latest_crm_contacts}</strong></div>
    <div>Instantly mirror leads: <strong>${state.latest_instantly_leads}</strong></div>
    <div>Recent events: <strong>${state.event_log.length}</strong></div>
  `;
}

function renderTopMetrics() {
  const latest = state.runs?.[0];
  topMetricsEl.innerHTML = `
    <span class="metric-pill">Runs: ${state.runs?.length || 0}</span>
    <span class="metric-pill">Last Run: ${latest?.status || 'n/a'}</span>
    <span class="metric-pill">Nodes: ${state.nodes?.length || 0}</span>
  `;
}

function renderFromNodeSelect() {
  fromNodeEl.innerHTML = '<option value="">Start from first node</option>';
  (state.nodes || []).forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    fromNodeEl.appendChild(opt);
  });
}

async function refresh() {
  state = await api('/api/state');
  if (!selectedRunId && state.runs?.length) selectedRunId = state.runs[0].run_id;
  renderPalette();
  renderCanvas();
  renderRuns();
  renderStats();
  renderTopMetrics();
  renderFromNodeSelect();
}

document.getElementById('run-full').onclick = async () => {
  await api('/api/run', { method: 'POST', body: JSON.stringify({}) });
  await refresh();
};

document.getElementById('run-dry').onclick = async () => {
  const fromNode = fromNodeEl.value || null;
  await api('/api/run', { method: 'POST', body: JSON.stringify({ from_node: fromNode, dry_run: true }) });
  await refresh();
};

document.getElementById('run-from-node').onclick = async () => {
  const fromNode = fromNodeEl.value || null;
  await api('/api/run', { method: 'POST', body: JSON.stringify({ from_node: fromNode }) });
  await refresh();
};

document.getElementById('upload-clay').onclick = async () => {
  const input = document.getElementById('clay-file');
  const status = document.getElementById('upload-status');
  if (!input.files.length) {
    status.textContent = 'Select a CSV file first.';
    return;
  }
  const file = input.files[0];
  const text = await file.text();
  const result = await api('/api/upload-clay', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content: text }),
  });
  status.textContent = `Uploaded: ${result.file}`;
  await refresh();
};

document.getElementById('fake-instantly-event').onclick = async () => {
  await api('/api/events/instantly', {
    method: 'POST',
    body: JSON.stringify({ external_lead_id: 'demo-lead', event_type: 'replied' }),
  });
  await refresh();
};

document.getElementById('manual-requeue').onclick = async () => {
  await api('/api/events/manual-requeue', {
    method: 'POST',
    body: JSON.stringify({ external_lead_ids: ['demo-lead', 'demo-lead-2'] }),
  });
  await refresh();
};

refresh().catch((err) => {
  inspectorEl.textContent = `Startup error: ${err.message}`;
});
