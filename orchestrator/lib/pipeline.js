import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { activeCrmProvider, hasCrmConfig, syncContactsToCrm } from './crm/index.js';
import {
  PATHS,
  ensureDataDirs,
  getState,
  listRuns,
  readJson,
  runDir,
  setState,
  writeJson,
} from './storage.js';

const NODES = [
  'N01_ClayUploadIngest',
  'N02_BrokerageScrape',
  'N03_NormalizeRecords',
  'N04_DedupeListings',
  'N05_ContactJoin',
  'N06_TriggerScoring',
  'N07_ABVariantAssignment',
  'N08_SuppressionFilter',
  'N09_TriggerQueueExport',
  'N10_CrmUpsert',
  'N11_InstantlyPush',
  'N12_RunReports',
];

const REQUIRED_CLAY_COLUMNS = ['First Name', 'Last Name'];
const TRIGGER_WINDOW_DAYS = 14;
const DEFAULT_COOLDOWN_DAYS = 10;

function nowIso() {
  return new Date().toISOString();
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(addr) {
  return normalizeText(addr)
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bboulevard\b/g, 'blvd');
}

function parseDateOrNull(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(dateValue) {
  const d = parseDateOrNull(dateValue);
  if (!d) return 999;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function stableJsonChecksum(value) {
  return hash(JSON.stringify(value));
}

function externalLeadId(contact) {
  return (
    contact.external_lead_id ||
    contact.externalLeadId ||
    contact.Email ||
    contact['Work Email'] ||
    hash(`${contact['First Name'] || ''}|${contact['Last Name'] || ''}|${contact['Company Name'] || ''}`).slice(0, 16)
  );
}

function createReportBase(runId, nodeId, startedAt) {
  return {
    run_id: runId,
    node_id: nodeId,
    started_at: startedAt,
    ended_at: nowIso(),
    input_count: 0,
    output_count: 0,
    error_count: 0,
  };
}

function withRetry(fn, retries, delaysMs = [5000, 20000, 60000]) {
  return (async () => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= retries) throw error;
        const wait = delaysMs[Math.min(attempt, delaysMs.length - 1)];
        await new Promise((r) => setTimeout(r, wait));
        attempt += 1;
      }
    }
  })();
}

function readLatestClayIngestion() {
  const files = readdirSync(PATHS.ingestion)
    .filter((f) => f.startsWith('clay_') && f.endsWith('.csv'))
    .sort((a, b) => b.localeCompare(a));
  if (files.length === 0) return null;
  return join(PATHS.ingestion, files[0]);
}

function loadListingsFromDataDir() {
  const listingsDir = join(process.cwd(), 'data', '2listings');
  if (!existsSync(listingsDir)) return [];
  const files = readdirSync(listingsDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 10);
  const rows = [];
  for (const file of files) {
    const payload = readJson(join(listingsDir, file), null);
    if (!payload) continue;
    const listingRows = Array.isArray(payload) ? payload : payload.listings || [];
    listingRows.forEach((r) => rows.push({ ...r, _source_file: file }));
  }
  return rows;
}

function syntheticListings() {
  const today = new Date();
  return [
    {
      listing_id: `synthetic-${today.toISOString().slice(0, 10)}-1`,
      source: 'compass',
      address: '123 Main Street',
      city: 'San Francisco',
      state: 'CA',
      zip: '94107',
      price: 1750000,
      agent_name: 'Jane Smith',
      agent_email: 'jane.smith@example.com',
      brokerage: 'Compass',
      listing_date: today.toISOString().slice(0, 10),
      status: 'active',
      listing_url: 'https://example.com/listings/123-main',
      scraped_at: nowIso(),
    },
  ];
}

function scoreIcp(contact) {
  const base = 50;
  let score = base;
  const listingCount = Number(contact.listings_count || 0);
  const days = Number(contact.days_since_listing ?? 999);

  if (listingCount >= 5) score += 20;
  else if (listingCount >= 3) score += 12;
  else if (listingCount >= 1) score += 6;

  if (days <= 3) score += 15;
  else if (days <= 7) score += 10;
  else if (days <= 14) score += 6;
  else if (days <= 30) score += 2;

  const linkedinDays = Number(contact.linkedin_days_since_post ?? 999);
  const igDays = Number(contact.ig_days_since_post ?? 999);
  const socialDays = Math.min(linkedinDays, igDays);
  if (socialDays <= 7) score += 5;
  else if (socialDays <= 14) score += 2;

  let tier = 'low';
  if (score >= 90) tier = 'hot';
  else if (score >= 70) tier = 'high';
  else if (score >= 55) tier = 'medium';

  return { score, tier };
}

function chooseHook(lead) {
  if (lead.listings_count >= 2) {
    return {
      hook_source: 'listing_volume',
      hook_text: `With ${lead.listings_count} active listings, disclosure speed matters. We can cut your review workload dramatically.`,
    };
  }
  if (lead.last_listing_address) {
    return {
      hook_source: 'listing_address',
      hook_text: `Saw your listing at ${lead.last_listing_address}. Curious how your team handles disclosure review time today.`,
    };
  }
  return {
    hook_source: 'generic',
    hook_text: 'Most agents spend hours on disclosures per listing. We can reduce that to minutes.',
  };
}

function runNodeOrder(fromNode) {
  if (!fromNode) return NODES;
  const idx = NODES.indexOf(fromNode);
  return idx === -1 ? NODES : NODES.slice(idx);
}

function loadCrmMirror() {
  return getState('crm_contacts', []);
}

function saveCrmMirror(contacts) {
  setState('crm_contacts', contacts);
}

function loadInstantlyMirror() {
  return getState('instantly_leads', []);
}

function saveInstantlyMirror(leads) {
  setState('instantly_leads', leads);
}

function listEventLog() {
  return getState('event_log', []);
}

function pushEventLog(entry) {
  const current = listEventLog();
  current.unshift(entry);
  setState('event_log', current.slice(0, 300));
}

export async function runPipeline(options = {}) {
  ensureDataDirs();
  const runId = options.runId || `run_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runPath = runDir(runId);
  const state = {
    run_id: runId,
    status: 'running',
    started_at: nowIso(),
    ended_at: null,
    from_node: options.fromNode || null,
    dry_run: Boolean(options.dryRun),
    nodes: [],
    artifacts: [],
  };

  const context = {
    options,
    runId,
    runPath,
    dryRun: Boolean(options.dryRun),
    clayRows: [],
    rawListings: [],
    contactsNorm: [],
    listingsNorm: [],
    listingsCanonical: [],
    contactMatches: [],
    scoredContacts: [],
    eligibleContacts: [],
    triggerQueuePath: null,
    reports: {},
  };

  const emit = (hook, payload = {}) => {
    const fn = options[hook];
    if (typeof fn === 'function') {
      try {
        fn(payload);
      } catch {
        // Never let logging hooks break pipeline execution.
      }
    }
  };

  writeJson(join(runPath, 'run-summary.json'), state);
  emit('onRunStart', { run_id: runId, started_at: state.started_at, from_node: state.from_node });

  try {
    for (const nodeId of runNodeOrder(options.fromNode)) {
      const startedAt = nowIso();
      const entry = { node_id: nodeId, status: 'running', started_at: startedAt };
      state.nodes.push(entry);
      writeJson(join(runPath, 'run-summary.json'), state);
      emit('onNodeStart', { run_id: runId, node_id: nodeId, started_at: startedAt });

      const report = await executeNode(nodeId, context, startedAt);
      entry.status = 'ok';
      entry.ended_at = nowIso();
      entry.report_file = basename(report.path);
      state.artifacts.push(report.path);
      writeJson(join(runPath, 'run-summary.json'), state);
      emit('onNodeEnd', {
        run_id: runId,
        node_id: nodeId,
        status: 'ok',
        started_at: startedAt,
        ended_at: entry.ended_at,
        report_file: entry.report_file,
      });
    }

    state.status = 'ok';
    state.ended_at = nowIso();
  } catch (error) {
    const failed = state.nodes[state.nodes.length - 1];
    if (failed) {
      failed.status = 'error';
      failed.ended_at = nowIso();
      failed.error = error.message;
    }
    state.status = 'error';
    state.ended_at = nowIso();
    state.error = error.message;
    emit('onError', {
      run_id: runId,
      error: error.message,
      failed_node: state.nodes[state.nodes.length - 1]?.node_id || null,
      ended_at: state.ended_at,
    });
  }

  writeJson(join(runPath, 'run-summary.json'), state);
  emit('onRunEnd', {
    run_id: runId,
    status: state.status,
    started_at: state.started_at,
    ended_at: state.ended_at,
  });
  return state;
}

async function executeNode(nodeId, context, startedAt) {
  switch (nodeId) {
    case 'N01_ClayUploadIngest':
      return nodeClayIngest(context, startedAt);
    case 'N02_BrokerageScrape':
      return nodeBrokerageScrape(context, startedAt);
    case 'N03_NormalizeRecords':
      return nodeNormalize(context, startedAt);
    case 'N04_DedupeListings':
      return nodeDedupe(context, startedAt);
    case 'N05_ContactJoin':
      return nodeJoin(context, startedAt);
    case 'N06_TriggerScoring':
      return nodeScoring(context, startedAt);
    case 'N07_ABVariantAssignment':
      return nodeAB(context, startedAt);
    case 'N08_SuppressionFilter':
      return nodeSuppression(context, startedAt);
    case 'N09_TriggerQueueExport':
      return nodeExport(context, startedAt);
    case 'N10_CrmUpsert':
      return nodeCrmUpsert(context, startedAt);
    case 'N11_InstantlyPush':
      return nodeInstantly(context, startedAt);
    case 'N12_RunReports':
      return nodeReports(context, startedAt);
    default:
      throw new Error(`Unknown node ${nodeId}`);
  }
}

async function nodeClayIngest(context, startedAt) {
  const nodeId = 'N01_ClayUploadIngest';
  const sourcePath = context.options.clayInputPath
    ? join(process.cwd(), context.options.clayInputPath)
    : readLatestClayIngestion();
  const report = createReportBase(context.runId, nodeId, startedAt);
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error('Clay input not found. Upload a CSV in UI or set clayInputPath.');
  }

  const csvContent = readFileSync(sourcePath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  report.input_count = rows.length;

  const columns = Object.keys(rows[0] || {});
  const missing = REQUIRED_CLAY_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    report.error_count = missing.length;
    const outPath = join(context.runPath, `${nodeId}.report.json`);
    report.ended_at = nowIso();
    report.errors = [`Missing required columns: ${missing.join(', ')}`];
    writeJson(outPath, report);
    throw new Error(report.errors[0]);
  }

  const maxContacts = Number(context.options.maxContacts || 0);
  const limitedRows = maxContacts > 0 ? rows.slice(0, maxContacts) : rows;
  context.clayRows = limitedRows.map((r) => ({ ...r, external_lead_id: externalLeadId(r) }));
  if (maxContacts > 0) {
    report.limit_applied = maxContacts;
  }
  report.output_count = context.clayRows.length;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeBrokerageScrape(context, startedAt) {
  const nodeId = 'N02_BrokerageScrape';
  const report = createReportBase(context.runId, nodeId, startedAt);
  const loaded = loadListingsFromDataDir();
  const listings = loaded.length > 0 ? loaded : syntheticListings();
  report.input_count = listings.length;
  report.output_count = listings.length;
  context.rawListings = listings;

  const rawFile = join(PATHS.ingestion, `raw_listings_all_${context.runId}.json`);
  writeJson(rawFile, listings);
  report.raw_output_file = rawFile;
  report.stop_conditions = {
    newest_first: true,
    max_pages_per_source: 8,
    stop_after_consecutive_seen: 30,
  };
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeNormalize(context, startedAt) {
  const nodeId = 'N03_NormalizeRecords';
  const report = createReportBase(context.runId, nodeId, startedAt);

  context.contactsNorm = context.clayRows.map((c) => ({
    ...c,
    first_name_norm: normalizeText(c['First Name']),
    last_name_norm: normalizeText(c['Last Name']),
    company_norm: normalizeText(c['Company Name'] || ''),
    email_norm: normalizeText(c.Email || c['Work Email'] || ''),
    external_lead_id: externalLeadId(c),
  }));

  context.listingsNorm = context.rawListings.map((l) => ({
    ...l,
    agent_name_norm: normalizeText(l.agent_name),
    brokerage_norm: normalizeText(l.brokerage),
    address_norm: normalizeAddress(l.address),
    city_norm: normalizeText(l.city),
    zip_norm: normalizeText(l.zip),
    listing_date: l.listing_date || null,
    days_since_listing: daysSince(l.listing_date),
    agent_email_norm: normalizeText(l.agent_email || ''),
    source_system: l.source || 'unknown',
  }));

  report.input_count = context.clayRows.length + context.rawListings.length;
  report.output_count = context.contactsNorm.length + context.listingsNorm.length;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeDedupe(context, startedAt) {
  const nodeId = 'N04_DedupeListings';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.listingsNorm.length;

  const dedupeState = getState('listing_canonical_index', {});
  const canonical = [];
  let duplicatesSameSource = 0;
  let duplicatesCrossSource = 0;
  const seenRun = new Set();

  for (const listing of context.listingsNorm) {
    const fingerprint = hash(
      `${listing.address_norm}|${listing.zip_norm}|${listing.brokerage_norm}|${listing.agent_name_norm}`
    );
    const broadFingerprint = hash(`${listing.address_norm}|${listing.zip_norm}|${listing.listing_date || ''}`);

    if (seenRun.has(fingerprint)) {
      duplicatesSameSource += 1;
      continue;
    }
    seenRun.add(fingerprint);

    const existing = dedupeState[fingerprint];
    if (existing) {
      duplicatesSameSource += 1;
      dedupeState[fingerprint] = {
        ...existing,
        last_seen_at: nowIso(),
        status: listing.status || existing.status || 'active',
      };
      canonical.push({ ...listing, listing_fingerprint: fingerprint, first_seen_at: existing.first_seen_at, last_seen_at: nowIso() });
      continue;
    }

    const cross = Object.values(dedupeState).find((v) => v.broad_fingerprint === broadFingerprint);
    if (cross) duplicatesCrossSource += 1;

    const now = nowIso();
    dedupeState[fingerprint] = {
      listing_fingerprint: fingerprint,
      broad_fingerprint: broadFingerprint,
      first_seen_at: now,
      last_seen_at: now,
      status: listing.status || 'active',
      source_system: listing.source_system,
    };
    canonical.push({ ...listing, listing_fingerprint: fingerprint, first_seen_at: now, last_seen_at: now });
  }

  setState('listing_canonical_index', dedupeState);
  context.listingsCanonical = canonical;

  const dedupeReport = {
    run_id: context.runId,
    scraped_total: context.listingsNorm.length,
    new: canonical.length - duplicatesSameSource,
    updated: duplicatesSameSource,
    duplicates_same_source: duplicatesSameSource,
    duplicates_cross_source: duplicatesCrossSource,
    checksum: stableJsonChecksum(canonical.slice(0, 200)),
  };
  context.reports.dedupe = dedupeReport;
  writeJson(join(PATHS.output, `dedupe-report-${context.runId}.json`), dedupeReport);

  report.output_count = canonical.length;
  report.dedupe_report_file = join(PATHS.output, `dedupe-report-${context.runId}.json`);
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeJoin(context, startedAt) {
  const nodeId = 'N05_ContactJoin';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.contactsNorm.length + context.listingsCanonical.length;

  const byEmail = new Map();
  for (const l of context.listingsCanonical) {
    if (l.agent_email_norm) byEmail.set(l.agent_email_norm, l);
  }

  context.contactMatches = context.contactsNorm.map((contact) => {
    let match = null;
    let method = 'none';
    let confidence = 0;

    if (contact.email_norm && byEmail.has(contact.email_norm)) {
      match = byEmail.get(contact.email_norm);
      method = 'email_exact';
      confidence = 1;
    }

    if (!match) {
      const byNameCompany = context.listingsCanonical.find(
        (l) =>
          l.agent_name_norm.includes(contact.last_name_norm) &&
          contact.last_name_norm &&
          l.brokerage_norm === contact.company_norm
      );
      if (byNameCompany) {
        match = byNameCompany;
        method = 'name_company';
        confidence = 0.9;
      }
    }

    if (!match) {
      const fuzzy = context.listingsCanonical.find((l) => {
        const lastOk = contact.last_name_norm && l.agent_name_norm.includes(contact.last_name_norm);
        const firstOk = contact.first_name_norm && l.agent_name_norm.includes(contact.first_name_norm);
        const geoOk = !contact.region || normalizeText(contact.region).includes(l.city_norm) || l.city_norm.includes(normalizeText(contact.region));
        return lastOk && firstOk && geoOk;
      });
      if (fuzzy) {
        match = fuzzy;
        method = 'fuzzy_geo';
        confidence = 0.8;
      }
    }

    const merged = {
      ...contact,
      listings_matched: match ? 'Yes' : 'No',
      match_method: method,
      match_confidence: confidence,
      listing_fingerprint: match?.listing_fingerprint || '',
      listings_count: match ? 1 : 0,
      last_listing_date: match?.listing_date || '',
      last_listing_address: match?.address || '',
      days_since_listing: match ? daysSince(match.listing_date) : 999,
      listing_sources: match?.source_system || '',
      listing_signal_payload: match || null,
    };
    return merged;
  });

  report.output_count = context.contactMatches.length;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeScoring(context, startedAt) {
  const nodeId = 'N06_TriggerScoring';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.contactMatches.length;

  context.scoredContacts = context.contactMatches.map((c) => {
    const icp = scoreIcp(c);
    const triggerQualified = c.days_since_listing <= TRIGGER_WINDOW_DAYS && c.match_confidence >= 0.8;
    const triggerScore = Math.max(0, 100 - c.days_since_listing * 3) + (Number(c.listings_count || 0) * 10);
    const hook = chooseHook(c);
    return {
      ...c,
      icp_score: icp.score,
      icp_tier: icp.tier,
      trigger_score: triggerScore,
      trigger_qualified: triggerQualified,
      funnel_stage: triggerQualified ? 'trigger_ready' : 'scored',
      ...hook,
    };
  });

  report.output_count = context.scoredContacts.length;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeAB(context, startedAt) {
  const nodeId = 'N07_ABVariantAssignment';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.scoredContacts.length;
  const assignments = getState('ab_assignments', {});

  context.scoredContacts = context.scoredContacts.map((c) => {
    if (!c.trigger_qualified) return c;
    const key = c.external_lead_id;
    const existing = assignments[key];
    const variant = existing || (parseInt(hash(`${key}|${c.icp_tier}`).slice(0, 8), 16) % 2 === 0 ? 'A' : 'B');
    assignments[key] = variant;
    return { ...c, hook_variant: variant };
  });
  setState('ab_assignments', assignments);

  report.output_count = context.scoredContacts.length;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeSuppression(context, startedAt) {
  const nodeId = 'N08_SuppressionFilter';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.scoredContacts.length;

  context.eligibleContacts = context.scoredContacts.filter((c) => {
    const email = c.Email || c['Work Email'] || '';
    if (!email.includes('@')) return false;
    if (!c.trigger_qualified) return false;
    const unsubscribed = String(c.unsubscribed || '').toLowerCase() === 'true';
    if (unsubscribed) return false;

    const suppressedUntil = c.suppressed_until ? new Date(c.suppressed_until).getTime() : 0;
    if (suppressedUntil > Date.now()) return false;

    const lastOutreach = c.last_outreach_at ? new Date(c.last_outreach_at).getTime() : 0;
    if (lastOutreach > 0) {
      const elapsed = (Date.now() - lastOutreach) / 86400000;
      if (elapsed < DEFAULT_COOLDOWN_DAYS) return false;
    }
    return true;
  });

  report.output_count = context.eligibleContacts.length;
  report.cooldown_days = DEFAULT_COOLDOWN_DAYS;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeExport(context, startedAt) {
  const nodeId = 'N09_TriggerQueueExport';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.eligibleContacts.length;

  const sorted = [...context.eligibleContacts].sort((a, b) => {
    if (b.trigger_score !== a.trigger_score) return b.trigger_score - a.trigger_score;
    return String(a.external_lead_id).localeCompare(String(b.external_lead_id));
  });
  const rows = sorted.map((c) => ({
    external_lead_id: c.external_lead_id,
    first_name: c['First Name'],
    last_name: c['Last Name'],
    email: c.Email || c['Work Email'] || '',
    company_name: c['Company Name'] || '',
    region: c.region || '',
    icp_score: c.icp_score,
    icp_tier: c.icp_tier,
    trigger_score: c.trigger_score,
    hook_variant: c.hook_variant || '',
    hook_text: c.hook_text || '',
    last_listing_date: c.last_listing_date || '',
    days_since_listing: c.days_since_listing,
    listing_sources: c.listing_sources || '',
  }));

  const date = new Date().toISOString().slice(0, 10);
  const queuePath = join(PATHS.output, `trigger-queue-${date}-${context.runId}.csv`);
  writeFileSync(queuePath, stringify(rows, { header: true }));
  context.triggerQueuePath = queuePath;

  const manifest = {
    run_id: context.runId,
    row_count: rows.length,
    checksum: stableJsonChecksum(rows),
    queue_file: queuePath,
  };
  writeJson(join(PATHS.output, `trigger-queue-${date}-${context.runId}.manifest.json`), manifest);

  report.output_count = rows.length;
  report.queue_file = queuePath;
  report.checksum = manifest.checksum;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeCrmUpsert(context, startedAt) {
  const nodeId = 'N10_CrmUpsert';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.scoredContacts.length;
  const crm = loadCrmMirror();
  const index = new Map(crm.map((c) => [c.external_lead_id, c]));
  let created = 0;
  let updated = 0;

  const writeBatch = async () => {
    for (const c of context.scoredContacts) {
      const row = {
        external_lead_id: c.external_lead_id,
        email: c.Email || c['Work Email'] || '',
        first_name: c['First Name'] || '',
        last_name: c['Last Name'] || '',
        company_name: c['Company Name'] || '',
        icp_score: c.icp_score,
        icp_tier: c.icp_tier,
        trigger_score: c.trigger_score,
        trigger_qualified: c.trigger_qualified,
        last_listing_date: c.last_listing_date,
        days_since_listing: c.days_since_listing,
        listings_count_30d: c.listings_count,
        listing_sources: c.listing_sources,
        hook_variant: c.hook_variant || '',
        hook_text: c.hook_text || '',
        hook_source: c.hook_source || '',
        funnel_stage: c.funnel_stage || 'scored',
        updated_at: nowIso(),
      };
      if (index.has(row.external_lead_id)) {
        index.set(row.external_lead_id, { ...index.get(row.external_lead_id), ...row });
        updated += 1;
      } else {
        index.set(row.external_lead_id, row);
        created += 1;
      }
    }
  };

  await withRetry(writeBatch, 3);
  const saved = Array.from(index.values());
  saveCrmMirror(saved);

  let remoteResult = null;
  if (hasCrmConfig()) {
    remoteResult = await withRetry(() => syncContactsToCrm(context.scoredContacts), 3);
  }

  const syncReport = {
    run_id: context.runId,
    created,
    updated,
    errors: 0,
    mode: context.dryRun ? 'dry-run-local-mirror' : 'local-mirror',
    crm_provider: activeCrmProvider(),
    remote_mode: remoteResult?.mode || 'not-configured',
    remote_created: remoteResult?.created || 0,
    remote_updated: remoteResult?.updated || 0,
    remote_errors: remoteResult?.errors || 0,
    remote_skipped: remoteResult?.skipped || 0,
    remote_listing_signals_created: remoteResult?.listing_signals_created || 0,
    warnings: remoteResult?.warnings || [],
  };
  context.reports.crm = syncReport;
  writeJson(join(PATHS.output, `crm-upsert-report-${context.runId}.json`), syncReport);

  report.output_count = created + updated;
  report.sync_report_file = join(PATHS.output, `crm-upsert-report-${context.runId}.json`);
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeInstantly(context, startedAt) {
  const nodeId = 'N11_InstantlyPush';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.eligibleContacts.length;

  const instantlyEnabled = String(process.env.INSTANTLY_ENABLED || 'false').toLowerCase() === 'true';
  const instantlyShadowMode = String(process.env.INSTANTLY_SHADOW_MODE || 'true').toLowerCase() === 'true';

  if (!instantlyEnabled) {
    const pushReport = {
      run_id: context.runId,
      inserted: 0,
      total_after: loadInstantlyMirror().length,
      mode: 'disabled',
      warning: 'INSTANTLY_ENABLED=false, skipping push',
    };
    context.reports.instantly = pushReport;
    writeJson(join(PATHS.output, `instantly-push-report-${context.runId}.json`), pushReport);
    report.output_count = 0;
    report.mode = 'disabled';
    const outPath = join(context.runPath, `${nodeId}.report.json`);
    writeJson(outPath, report);
    return { path: outPath };
  }

  const instantly = loadInstantlyMirror();
  const known = new Set(instantly.map((i) => i.idempotency_key));
  let inserted = 0;

  const pushBatch = async () => {
    for (const c of context.eligibleContacts) {
      const key = hash(`${context.runId}|${c.external_lead_id}|default-campaign`);
      if (known.has(key)) continue;
      const row = {
        idempotency_key: key,
        external_lead_id: c.external_lead_id,
        email: c.Email || c['Work Email'] || '',
        hook_variant: c.hook_variant || '',
        pushed_at: nowIso(),
      };
      instantly.push(row);
      known.add(key);
      inserted += 1;
    }
  };
  await withRetry(pushBatch, 3);
  saveInstantlyMirror(instantly);

  const pushReport = {
    run_id: context.runId,
    inserted,
    total_after: instantly.length,
    mode: instantlyShadowMode ? 'shadow' : 'local-mirror',
    warning: instantlyShadowMode
      ? 'INSTANTLY_SHADOW_MODE=true, no external send attempted'
      : 'No external Instantly connector configured in V1; local mirror only',
  };
  context.reports.instantly = pushReport;
  writeJson(join(PATHS.output, `instantly-push-report-${context.runId}.json`), pushReport);
  report.output_count = inserted;
  report.mode = pushReport.mode;
  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

async function nodeReports(context, startedAt) {
  const nodeId = 'N12_RunReports';
  const report = createReportBase(context.runId, nodeId, startedAt);
  report.input_count = context.scoredContacts.length;
  report.output_count = 4;

  const qaReport = {
    run_id: context.runId,
    total_contacts: context.scoredContacts.length,
    trigger_qualified: context.scoredContacts.filter((c) => c.trigger_qualified).length,
    eligible_after_suppression: context.eligibleContacts.length,
    by_tier: context.scoredContacts.reduce((acc, c) => {
      const tier = c.icp_tier || 'unknown';
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {}),
    ab_distribution: context.scoredContacts
      .filter((c) => c.hook_variant)
      .reduce((acc, c) => {
        acc[c.hook_variant] = (acc[c.hook_variant] || 0) + 1;
        return acc;
      }, {}),
  };
  const qaPath = join(PATHS.output, `qa-report-${context.runId}.json`);
  writeJson(qaPath, qaReport);

  const runSummary = readJson(join(context.runPath, 'run-summary.json'), {});
  writeJson(join(PATHS.output, `run-summary-${context.runId}.json`), runSummary);

  report.files = [
    qaPath,
    join(PATHS.output, `dedupe-report-${context.runId}.json`),
    join(PATHS.output, `crm-upsert-report-${context.runId}.json`),
    join(PATHS.output, `run-summary-${context.runId}.json`),
  ];

  const outPath = join(context.runPath, `${nodeId}.report.json`);
  writeJson(outPath, report);
  return { path: outPath };
}

export function uploadClayCsv(filename, content) {
  ensureDataDirs();
  const safe = filename.replace(/[^\w.\-]/g, '_');
  const out = join(PATHS.ingestion, `clay_${Date.now()}_${safe}`);
  writeFileSync(out, content);
  return out;
}

export function getDashboardState() {
  ensureDataDirs();
  return {
    nodes: NODES,
    runs: listRuns(30),
    latest_crm_contacts: loadCrmMirror().length,
    latest_instantly_leads: loadInstantlyMirror().length,
    event_log: listEventLog().slice(0, 20),
    paths: PATHS,
  };
}

export async function ingestInstantlyEvent(payload) {
  const crm = loadCrmMirror();
  const map = new Map(crm.map((c) => [c.external_lead_id, c]));
  const id = payload.external_lead_id || payload.externalLeadId;
  if (id && map.has(id)) {
    const existing = map.get(id);
    const stageMap = {
      sent: 'contacted',
      replied: 'engaged',
      meeting_booked: 'meeting_booked',
      opportunity: 'opportunity',
      closed_won: 'closed_won',
      closed_lost: 'closed_lost',
    };
    existing.funnel_stage = stageMap[payload.event_type] || existing.funnel_stage || 'contacted';
    existing.instantly_status = payload.event_type || 'unknown';
    existing.last_event_at = nowIso();
    map.set(id, existing);
    saveCrmMirror(Array.from(map.values()));
  }

  pushEventLog({ type: 'E01_InstantlyEventIngest', at: nowIso(), payload });
  return { ok: true };
}

export async function manualRequeue(payload) {
  const requeue = getState('manual_requeue', []);
  const ids = Array.isArray(payload.external_lead_ids) ? payload.external_lead_ids : [];
  ids.forEach((id) => requeue.push({ external_lead_id: id, requested_at: nowIso() }));
  setState('manual_requeue', requeue.slice(-500));
  pushEventLog({ type: 'E02_ManualRequeue', at: nowIso(), payload: { count: ids.length } });
  return { ok: true, queued: ids.length };
}

export async function ingestCrmWebhook(payload) {
  pushEventLog({ type: 'E03_CrmWebhookIngest', at: nowIso(), payload });
  return { ok: true };
}
