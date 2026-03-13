#!/usr/bin/env node

/**
 * Push to Instantly — Send batch CSV leads to Instantly campaigns
 *
 * Reads a batch CSV (from prepare-batch.js), assigns inboxes from the shared
 * pool (lowest daily send count), pushes to the correct Instantly campaign,
 * and updates Twenty CRM with campaign ID + assigned inbox.
 *
 * Campaign routing:
 *   Fetches all campaigns from Instantly and matches each lead to its campaign
 *   by name: {tier}_{variant}_{testName} (e.g. hot_A_subject_v1, medium_C_nurture_v1).
 *
 * Usage:
 *   node scripts/push-to-instantly.js <csv> [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import {
  getEnv,
  withRetry,
} from './lib/twenty-client.js';
import { getInboxPool, buildCampaignLabel } from './lib/constants.js';
import { createLogger } from './lib/logger.js';
import { initDb, updateLeads } from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI helpers (used when running directly)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Instantly API clients — v2 for campaigns, v1 for lead push
// ---------------------------------------------------------------------------

const INSTANTLY_V1_BASE = 'https://api.instantly.ai/api/v1';
const INSTANTLY_V2_BASE = 'https://api.instantly.ai/api/v2';

async function v2Fetch(method, path, body) {
  const apiKey = getEnv('INSTANTLY_API_KEY');
  if (!apiKey) throw new Error('INSTANTLY_API_KEY not set in .env');

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const response = await fetch(`${INSTANTLY_V2_BASE}${path}`, opts);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly v2 ${method} ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function v1LeadAdd(leads, campaignId) {
  const orgAuth = getEnv('INSTANTLY_ORG_AUTH');
  if (!orgAuth) throw new Error('INSTANTLY_ORG_AUTH not set in .env (get from Instantly UI x-org-auth header)');

  const response = await fetch(`${INSTANTLY_V1_BASE}/lead/add`, {
    method: 'POST',
    headers: {
      'x-org-auth': orgAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      leads,
      campaign_id: campaignId,
      skip_if_in_campaign: true,
      skip_if_in_workspace: false,
      verifyLeadsOnImport: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`v1/lead/add failed: ${response.status} ${text}`);
  }
  return response.json();
}

/**
 * Fetch all campaigns from Instantly and build a name→ID lookup map.
 */
async function fetchCampaignMap(log) {
  log.info('Fetching campaign list from Instantly');
  const result = await withRetry(() => v2Fetch('GET', '/campaigns?limit=100'), 2, [3000, 10000]);
  const campaigns = result?.items || result?.data || result || [];

  const map = new Map();
  for (const c of campaigns) {
    const name = (c.name || '').trim();
    const id = c.id;
    if (name && id) {
      map.set(name, id);
    }
  }
  log.info('Campaign map built', { count: map.size });
  return map;
}

/**
 * Resolve the Instantly campaign ID for a lead row using the campaign name map.
 */
function resolveCampaignId(row, campaignNameMap, testName) {
  const tier = (row.icp_tier || '').toLowerCase();
  const variant = (row.abVariant || '').toUpperCase();

  // For C/D campaigns, use their default test names if none provided
  let effectiveTest = testName || '';
  if (variant === 'C' && !effectiveTest) effectiveTest = 'nurture_v1';
  if (variant === 'D' && !effectiveTest) effectiveTest = 'followup_v1';

  const label = buildCampaignLabel(tier, variant, effectiveTest);
  return { label, campaignId: campaignNameMap.get(label) || null };
}

async function pushLeadsToCampaign(campaignId, leads, log) {
  // v1 /lead/add supports bulk (up to ~100 per call)
  const CHUNK_SIZE = 100;
  const results = { pushed: 0, skipped: 0, errors: 0, errorDetails: [] };

  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE);
    const v1Leads = chunk.map(lead => ({
      email: lead.email,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      company_name: lead.company_name || '',
      custom_variables: {
        icp_score: String(lead.icp_score || ''),
        icp_tier: lead.icp_tier || '',
        hook_text: lead.hook_text || '',
        hook_source: lead.hook_source || '',
        ig_username: lead.ig_username || '',
        ig_followers: String(lead.ig_followers || ''),
        linkedin_headline: lead.linkedin_headline || '',
        linkedin_recent_topic: lead.linkedin_recent_topic || '',
        region: lead.region || '',
        personalized_subject: lead.personalized_subject || '',
        personalized_hook: lead.personalized_hook || lead.hook_text || '',
      },
    }));

    try {
      const result = await withRetry(async () => {
        return v1LeadAdd(v1Leads, campaignId);
      }, 2, [3000, 10000]);

      const uploaded = result.leads_uploaded || 0;
      const alreadyIn = result.already_in_campaign || 0;
      results.pushed += uploaded;
      results.skipped += alreadyIn + (result.skipped_count || 0);
      log.info(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${uploaded} uploaded, ${alreadyIn} already in campaign, ${result.in_blocklist || 0} blocklisted`);
    } catch (err) {
      log.error(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1} FAILED`, { campaignId, error: err.message });
      results.errors += chunk.length;
      if (results.errorDetails.length < 10) {
        results.errorDetails.push(`chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${err.message}`);
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Inbox routing — shared pool, lowest daily send count
// ---------------------------------------------------------------------------

function assignInboxes(rows, inboxPool, isNurture) {
  const sendCounts = new Map();
  for (const inbox of inboxPool) {
    sendCounts.set(inbox, 0);
  }

  for (const row of rows) {
    if (isNurture && row.assignedInbox) {
      row._assignedInbox = row.assignedInbox;
      const count = sendCounts.get(row.assignedInbox);
      if (count !== undefined) sendCounts.set(row.assignedInbox, count + 1);
    } else {
      let minInbox = inboxPool[0];
      let minCount = sendCounts.get(minInbox) ?? 0;
      for (const inbox of inboxPool) {
        const count = sendCounts.get(inbox) ?? 0;
        if (count < minCount) {
          minInbox = inbox;
          minCount = count;
        }
      }
      row._assignedInbox = minInbox;
      sendCounts.set(minInbox, minCount + 1);
    }
  }

  return sendCounts;
}

// ---------------------------------------------------------------------------
// Push manifest — atomicity for CRM updates
// ---------------------------------------------------------------------------

function writeManifest(manifestPath, rows, campaignMap) {
  const manifest = {
    createdAt: new Date().toISOString(),
    leads: rows.filter(r => r.twentyId).map(r => ({
      email: r.email,
      twentyId: r.twentyId,
      abVariant: r.abVariant,
      assignedInbox: r._assignedInbox || '',
    })),
    campaignMap: Object.fromEntries(campaignMap),
    crmUpdated: false,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function markManifestComplete(manifestPath) {
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  manifest.crmUpdated = true;
  manifest.completedAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main (exported for programmatic use)
// ---------------------------------------------------------------------------

export async function main(opts = {}) {
  const csvPath = opts.csvPath || args.find((a) => !a.startsWith('-'));
  const dryRun = opts.dryRun ?? hasFlag('--dry-run');
  const log = opts.log || createLogger({ step: 'push' });
  const manifestDir = opts.manifestDir || null;

  if (!csvPath) {
    throw new Error('CSV path is required');
  }

  // Parse CSV
  const fullPath = resolve(csvPath);
  const csvContent = readFileSync(fullPath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

  // Detect mode from CSV content
  const isNurture = rows.some((r) => r.mode === 'nurture' || r.abVariant === 'C');
  const isSoftFollowup = rows.some((r) => r.mode === 'soft_followup' || r.abVariant === 'D');

  const pushModeLabels = {
    soft_followup: 'SOFT FOLLOW-UP (Campaign D)',
    nurture: 'NURTURE (Campaign C)',
    first_touch: 'FIRST TOUCH (A/B)',
  };
  const pushMode = isSoftFollowup ? 'soft_followup' : isNurture ? 'nurture' : 'first_touch';

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PUSH TO INSTANTLY — ${pushModeLabels[pushMode]}`);
  console.log('═══════════════════════════════════════════════════════════');

  console.log(`\nReading: ${fullPath}`);
  log.info('Batch loaded for push', { count: rows.length, mode: pushMode });

  // Check Instantly API keys (v2 for campaigns, v1 org auth for lead push)
  if (!getEnv('INSTANTLY_API_KEY')) {
    throw new Error('INSTANTLY_API_KEY must be set in .env');
  }
  if (!getEnv('INSTANTLY_ORG_AUTH')) {
    throw new Error('INSTANTLY_ORG_AUTH must be set in .env (get from Instantly UI x-org-auth header)');
  }

  // Fetch campaign map from Instantly and resolve each lead's campaign
  const campaignNameMap = await fetchCampaignMap(log);
  const batchTestName = rows.find((r) => r.testName)?.testName || opts.testName || getArg('--test') || '';

  // Group leads by resolved campaign
  const leadsByCampaign = new Map(); // campaignId -> { label, leads[] }
  const unresolved = [];

  for (const row of rows) {
    const { label, campaignId } = resolveCampaignId(row, campaignNameMap, batchTestName);
    row._campaignLabel = label;
    row._campaignId = campaignId;

    if (!campaignId) {
      unresolved.push({ email: row.email, tier: row.icp_tier, variant: row.abVariant, expectedName: label });
    } else {
      if (!leadsByCampaign.has(campaignId)) {
        leadsByCampaign.set(campaignId, { label, leads: [] });
      }
      leadsByCampaign.get(campaignId).leads.push(row);
    }
  }

  // Report routing
  console.log(`\n  Campaign routing (${leadsByCampaign.size} campaigns):`);
  for (const [cid, { label, leads }] of leadsByCampaign) {
    console.log(`    ${label}: ${leads.length} leads -> ${cid.slice(0, 8)}...`);
  }

  if (unresolved.length > 0) {
    console.log(`\n  WARNING: ${unresolved.length} leads could not be matched to a campaign:`);
    const missing = [...new Set(unresolved.map((u) => u.expectedName))];
    for (const name of missing) {
      const count = unresolved.filter((u) => u.expectedName === name).length;
      console.log(`    "${name}" — ${count} leads (campaign not found in Instantly)`);
    }
    log.warn('Unresolved campaign leads', { count: unresolved.length, missingCampaigns: missing });

    if (unresolved.length === rows.length) {
      throw new Error(`No leads matched any Instantly campaign. Expected names like: ${missing.slice(0, 3).join(', ')}`);
    }
  }

  // Inbox routing
  const inboxPool = getInboxPool();
  const routableRows = rows.filter((r) => r._campaignId);
  let sendCounts;
  if (inboxPool.length > 0) {
    console.log(`\n  Inbox pool: ${inboxPool.length} inboxes`);
    sendCounts = assignInboxes(routableRows, inboxPool, isNurture || isSoftFollowup);

    console.log('  Inbox distribution:');
    for (const [inbox, count] of sendCounts) {
      const short = inbox.split('@')[0];
      console.log(`    ${short}: ${count} leads`);
    }
  } else {
    console.log('\n  INSTANTLY_INBOXES not set — Instantly will auto-distribute across sender accounts');
  }

  // Shadow mode: INSTANTLY_ENABLED=false or INSTANTLY_SHADOW_MODE=true → dry run
  const instantlyEnabled = getEnv('INSTANTLY_ENABLED', 'true').toLowerCase() !== 'false';
  const shadowMode = getEnv('INSTANTLY_SHADOW_MODE', 'false').toLowerCase() === 'true';
  const effectiveDryRun = dryRun || !instantlyEnabled || shadowMode;

  if (!instantlyEnabled) {
    console.log('\n  INSTANTLY_ENABLED=false — running in dry-run mode');
  } else if (shadowMode) {
    console.log('\n  INSTANTLY_SHADOW_MODE=true — running in shadow mode (no API calls)');
  }

  if (effectiveDryRun) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  DRY RUN — No API calls made');
    console.log('═══════════════════════════════════════════════════════════');
    for (const [cid, { label, leads }] of leadsByCampaign) {
      console.log(`  Would push ${leads.length} leads to "${label}" (${cid.slice(0, 8)}...)`);
    }
    console.log(`  Would update ${routableRows.length} leads in SQLite`);
    return { metrics: { pushed: 0, errors: 0, crm_updated: 0, unresolved: unresolved.length } };
  }

  // Push to Instantly via v1 /lead/add (bulk, chunks of 100)
  let totalPushed = 0;
  let totalErrors = 0;
  const pushedEmails = new Set();

  for (const [campaignId, { label, leads }] of leadsByCampaign) {
    log.info(`Pushing to campaign "${label}"`, { campaignId, count: leads.length });
    const result = await pushLeadsToCampaign(campaignId, leads, log);
    log.info(`Campaign "${label}" pushed`, { pushed: result.pushed, skipped: result.skipped, errors: result.errors });
    totalPushed += result.pushed;
    totalErrors += result.errors;
    // v1 bulk: if no errors in the campaign, all leads were processed (uploaded or skipped)
    if (result.errors === 0) {
      for (const lead of leads) {
        pushedEmails.add(lead.email);
      }
    }
  }

  // Update SQLite — only for leads that were successfully pushed
  let crmUpdated = 0;
  const campaignMap = new Map();

  initDb();
  if (pushedEmails.size > 0) {
    const now = new Date().toISOString();
    const inboundDomain = getEnv('GTM_INBOUND_DOMAIN', 'inbound.discloser.co');
    const targetStage = isSoftFollowup ? 'contacted' : isNurture ? 'nurture' : 'contacted';

    const updates = routableRows
      .filter((r) => r.twentyId && pushedEmails.has(r.email))
      .map((r) => {
        const label = r._campaignLabel;
        const cid = r._campaignId;

        if (!campaignMap.has(cid)) campaignMap.set(cid, new Set());
        campaignMap.get(cid).add(label);

        const update = {
          id: r.twentyId,
          funnel_stage: targetStage,
          last_outreach_date: now,
          instantly_campaign_id: cid,
          outreach_status: 'sent',
          ab_variant: r.abVariant,
          assigned_inbox: r._assignedInbox || '',
          campaign_label: label,
        };
        if (!isNurture && !isSoftFollowup) {
          update.first_contacted_at = now;
        }
        if (batchTestName) {
          update.ab_test_name = batchTestName;
        }
        if (!isNurture) {
          update.reply_to_address = `disclosure-${crypto.randomUUID()}@${inboundDomain}`;
        }
        return update;
      });

    // Write push manifest before CRM update
    if (manifestDir) {
      const manifestPath = join(manifestDir, 'push-manifest.json');
      writeManifest(manifestPath, routableRows, campaignMap);
    }

    log.info('Updating SQLite', { count: updates.length });
    updateLeads(updates);
    crmUpdated = updates.length;
    log.info('SQLite updated', { updated: updates.length, errors: 0 });

    // Mark manifest as complete
    if (manifestDir) {
      markManifestComplete(join(manifestDir, 'push-manifest.json'));
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PUSH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');

  for (const [cid, labelSet] of campaignMap) {
    const labels = [...labelSet].sort().join(', ');
    const count = routableRows.filter((r) => r._campaignId === cid).length;
    console.log(`  ${labels}: ${count} contacts added`);
  }

  console.log(`\n  Total pushed: ${totalPushed}, Errors: ${totalErrors}`);
  if (unresolved.length > 0) {
    console.log(`  Unresolved (skipped): ${unresolved.length}`);
  }

  console.log(`\n  SQLite updates:`);
  console.log(`    funnelStage -> '${isSoftFollowup ? 'contacted' : isNurture ? 'nurture' : 'contacted'}': ${routableRows.filter((r) => r.twentyId).length}`);
  console.log(`    lastOutreachDate set: ${routableRows.filter((r) => r.twentyId).length}`);
  console.log(`    instantlyCampaignId set: ${routableRows.filter((r) => r.twentyId).length}`);
  console.log(`    assignedInbox set: ${routableRows.filter((r) => r._assignedInbox).length}`);
  if (batchTestName) {
    console.log(`    abTestName: "${batchTestName}"`);
  }

  if (campaignMap && campaignMap.size > 0) {
    console.log('\n  CAMPAIGN ROUTING MAP:');
    console.log('  ┌──────────────────────────────────────┬──────────────────────────────┐');
    console.log('  │ Campaign ID                          │ Name                         │');
    console.log('  ├──────────────────────────────────────┼──────────────────────────────┤');
    for (const [cid, labels] of campaignMap) {
      const labelStr = [...labels].sort().join(', ');
      const shortId = cid.length > 36 ? cid.slice(0, 33) + '...' : cid;
      console.log(`  │ ${shortId.padEnd(36)} │ ${labelStr.padEnd(28)} │`);
    }
    console.log('  └──────────────────────────────────────┴──────────────────────────────┘');
  }

  if (inboxPool.length > 0 && sendCounts) {
    console.log('\n  INBOX UTILIZATION:');
    console.log('  ┌─────────────────────────┬───────┐');
    console.log('  │ Inbox                   │ Sends │');
    console.log('  ├─────────────────────────┼───────┤');
    for (const [inbox, count] of sendCounts) {
      console.log(`  │ ${inbox.padEnd(23)} │ ${String(count).padStart(5)} │`);
    }
    console.log('  └─────────────────────────┴───────┘');
  }

  const metrics = { pushed: totalPushed, errors: totalErrors, crm_updated: crmUpdated, unresolved: unresolved.length };
  log.info('Push complete', metrics);

  return { metrics };
}

// Only run when called directly from CLI
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
