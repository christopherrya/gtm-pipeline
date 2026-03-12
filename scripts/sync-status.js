#!/usr/bin/env node

/**
 * Sync Status — Poll Instantly for opens/replies/bounces, update Twenty CRM
 *
 * Polls the Instantly API for lead status changes, maps them to Twenty funnel
 * stages, and batch updates the CRM. Can run once or loop on a 30-min interval.
 *
 * Usage:
 *   node scripts/sync-status.js [--once] [--verbose]
 */

import {
  hasTwentyConfig,
  paginateAll,
  batchUpdate,
  getEnv,
  withRetry,
  toInt,
} from './lib/twenty-client.js';
import {
  INSTANTLY_STATUS_MAP,
  FUNNEL_STAGES,
  SEQUENCE_DURATION_DAYS,
  RE_ENGAGE_RULES,
  isReEngageEligible,
} from './lib/constants.js';
import { createLogger } from './lib/logger.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function hasFlag(flag) {
  return args.includes(flag);
}

const runOnce = hasFlag('--once');
const verbose = hasFlag('--verbose');
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const log = createLogger({ step: 'sync' });

// ---------------------------------------------------------------------------
// Instantly v2 API client
// ---------------------------------------------------------------------------

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';

async function instantlyFetch(method, path) {
  const apiKey = getEnv('INSTANTLY_API_KEY');
  if (!apiKey) throw new Error('INSTANTLY_API_KEY not set in .env');

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  const response = await fetch(`${INSTANTLY_BASE}${path}`, opts);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly API ${method} ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function getLeadsByCampaign(campaignId) {
  const allLeads = [];
  let cursor = null;

  while (true) {
    const cursorParam = cursor ? `&starting_after=${encodeURIComponent(cursor)}` : '';
    const result = await withRetry(async () => {
      return instantlyFetch('GET', `/leads?campaign_id=${encodeURIComponent(campaignId)}&limit=100${cursorParam}`);
    }, 2, [3000, 10000]);

    const leads = result?.items || result?.leads || result?.data || [];
    if (!Array.isArray(leads) || leads.length === 0) break;
    allLeads.push(...leads);

    if (result.next_cursor) {
      cursor = result.next_cursor;
    } else if (leads.length === 100) {
      cursor = leads[leads.length - 1].id;
    } else {
      break;
    }
  }
  return allLeads;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

function shouldUpdateStage(currentStage, newStage) {
  const currentIdx = FUNNEL_STAGES.indexOf(currentStage);
  const newIdx = FUNNEL_STAGES.indexOf(newStage);
  // Only advance forward in the funnel (except bounced/unsubscribed override anything)
  if (newStage === 'bounced' || newStage === 'unsubscribed') return true;
  return newIdx > currentIdx;
}

async function syncOnce() {
  const startTime = Date.now();
  console.log(`\n  [${new Date().toISOString()}] Starting sync...`);

  if (!hasTwentyConfig()) {
    console.error('  Error: Twenty CRM not configured');
    return;
  }

  // Load contacts from Twenty that have an instantlyCampaignId.
  // Filter client-side: Twenty rejects neq with an empty string value.
  console.log('  Loading contacts with Instantly campaign IDs...');
  const allPeople = await paginateAll('people');
  const people = allPeople.filter((p) => !!p.instantlyCampaignId);
  log.info('Contacts linked to Instantly loaded', { count: people.length });

  if (people.length === 0) {
    log.info('No contacts to sync');
    return;
  }

  // Group by campaign ID
  const byCampaign = {};
  for (const p of people) {
    const cid = p.instantlyCampaignId;
    if (!cid) continue;
    if (!byCampaign[cid]) byCampaign[cid] = [];
    byCampaign[cid].push(p);
  }

  const campaignIds = Object.keys(byCampaign);
  console.log(`  Campaigns to poll: ${campaignIds.length}`);

  // Poll Instantly for each campaign
  const updates = [];
  let changesDetected = 0;

  for (const campaignId of campaignIds) {
    const twentyPeople = byCampaign[campaignId];
    if (verbose) console.log(`\n  Polling campaign ${campaignId} (${twentyPeople.length} contacts)...`);

    let instantlyLeads;
    try {
      instantlyLeads = await getLeadsByCampaign(campaignId);
    } catch (err) {
      console.error(`  Error polling campaign ${campaignId}: ${err.message}`);
      continue;
    }

    if (verbose) console.log(`  Got ${instantlyLeads.length} leads from Instantly`);

    // Build email -> Instantly lead map
    const instantlyMap = new Map();
    for (const lead of instantlyLeads) {
      const email = (lead.email || '').toLowerCase();
      if (email) instantlyMap.set(email, lead);
    }

    // Check each Twenty person against Instantly status
    for (const person of twentyPeople) {
      const email = (person.emails?.primaryEmail || '').toLowerCase();
      const instantlyLead = instantlyMap.get(email);
      if (!instantlyLead) continue;

      // Determine the highest-priority status from Instantly
      const instantlyStatus = instantlyLead.status || instantlyLead.lead_status || '';
      const newStage = INSTANTLY_STATUS_MAP[instantlyStatus];
      if (!newStage) continue;

      const currentStage = person.funnelStage || 'contacted';
      if (shouldUpdateStage(currentStage, newStage)) {
        const now = new Date().toISOString();
        const update = {
          id: person.id,
          funnelStage: newStage,
          outreachStatus: instantlyStatus,
        };
        // Set event timestamps on first occurrence only
        if (newStage === 'opened' && !person.emailOpenedAt) {
          update.emailOpenedAt = now;
        }
        if (newStage === 'replied' && !person.repliedAt) {
          update.repliedAt = now;
        }
        updates.push(update);
        changesDetected++;
        if (verbose) {
          console.log(`    ${email}: ${currentStage} -> ${newStage}`);
        }
      }
    }
  }

  log.info('Status changes detected', { count: changesDetected });

  // Detect sequence completions — contacts where the sequence has finished
  const sequenceUpdates = detectSequenceCompletions(people);
  if (sequenceUpdates.length > 0) {
    updates.push(...sequenceUpdates);
    if (verbose) {
      console.log(`\n  Sequence completions detected: ${sequenceUpdates.length}`);
      for (const u of sequenceUpdates) {
        console.log(`    ${u._email}: ${u._fromStage} -> ${u.funnelStage}`);
      }
    }
  }

  // Detect re-engage eligible contacts
  const reEngageUpdates = detectReEngageReady(people);
  if (reEngageUpdates.length > 0) {
    updates.push(...reEngageUpdates);
    if (verbose) {
      console.log(`\n  Re-engage ready: ${reEngageUpdates.length}`);
    }
  }

  // Batch update Twenty
  // Strip internal tracking fields before sending to API
  const cleanUpdates = updates.map(({ _email, _fromStage, ...rest }) => rest);
  if (cleanUpdates.length > 0) {
    log.info('Applying CRM updates', { count: cleanUpdates.length });
    const result = await batchUpdate('people', cleanUpdates);
    log.info('CRM updates applied', { updated: result.updated, errors: result.errors });
  }

  // Print funnel report
  await printFunnelReport();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Sync completed in ${elapsed}s`);
}

/**
 * Detect contacts whose sequence has finished (14+ days since first touch)
 * and categorize them based on engagement level.
 */
function detectSequenceCompletions(people) {
  const now = Date.now();
  const updates = [];

  for (const person of people) {
    const stage = person.funnelStage || '';
    const lastOutreach = person.lastOutreachDate;
    if (!lastOutreach) continue;

    const daysSinceOutreach = (now - new Date(lastOutreach).getTime()) / 86400000;
    if (daysSinceOutreach < SEQUENCE_DURATION_DAYS) continue;

    // Only transition from active sequence stages
    if (stage === 'contacted') {
      // Sent all emails, never opened a single one
      updates.push({
        id: person.id,
        funnelStage: 'sequence_complete',
        outreachStatus: 'sequence_complete_no_open',
        _email: person.emails?.primaryEmail || '',
        _fromStage: stage,
      });
    } else if (stage === 'opened') {
      // Opened but never replied — eligible for Campaign C (nurture)
      updates.push({
        id: person.id,
        funnelStage: 'opened_no_reply',
        outreachStatus: 'sequence_complete_no_reply',
        _email: person.emails?.primaryEmail || '',
        _fromStage: stage,
      });
    } else if (stage === 'nurture') {
      // In Campaign C (nurture) — 2 emails over ~7 days, check if sequence is done
      // Nurture is shorter, so check after 10 days to be safe
      if (daysSinceOutreach >= 10) {
        updates.push({
          id: person.id,
          funnelStage: 'nurture_complete',
          outreachStatus: 'nurture_complete_no_reply',
          _email: person.emails?.primaryEmail || '',
          _fromStage: stage,
        });
      }
    } else if (stage === 'replied') {
      // Replied but went cold — check if reply was >14 days ago with no further activity
      // (This is a heuristic; ideally we'd check last reply timestamp from Instantly)
      if (daysSinceOutreach >= SEQUENCE_DURATION_DAYS + 14) {
        updates.push({
          id: person.id,
          funnelStage: 'replied_went_cold',
          outreachStatus: 'replied_went_cold',
          _email: person.emails?.primaryEmail || '',
          _fromStage: stage,
        });
      }
    }
  }

  return updates;
}

/**
 * Detect contacts in post-sequence stages whose cooldown has expired
 * and are eligible for re-engagement.
 */
function detectReEngageReady(people) {
  const updates = [];

  for (const person of people) {
    const stage = person.funnelStage || '';
    const reEngageAttempts = toInt(person.reEngageAttempts);
    const lastOutreach = person.lastOutreachDate;

    if (!RE_ENGAGE_RULES[stage]) continue;
    if (!isReEngageEligible(stage, lastOutreach, reEngageAttempts)) continue;

    // Check maxAttempts for replied_went_cold fallback
    const rule = RE_ENGAGE_RULES[stage];
    if (stage === 'replied_went_cold' && reEngageAttempts >= rule.maxAttempts) {
      // After soft follow-up fails, move to 90-day long cooldown
      const elapsed = (Date.now() - new Date(lastOutreach).getTime()) / 86400000;
      if (elapsed < rule.fallbackCooldownDays) continue;
    }

    updates.push({
      id: person.id,
      funnelStage: 're_engage_ready',
      outreachStatus: `re_engage_from_${stage}`,
      _email: person.emails?.primaryEmail || '',
      _fromStage: stage,
    });
  }

  return updates;
}

async function printFunnelReport() {
  console.log('\n  FUNNEL SNAPSHOT:');
  console.log('  ┌────────────────────┬───────┐');
  console.log('  │ Stage              │ Count │');
  console.log('  ├────────────────────┼───────┤');

  let total = 0;
  for (const stage of FUNNEL_STAGES) {
    const filter = { and: [{ funnelStage: { eq: stage } }] };
    try {
      const people = await paginateAll('people', filter);
      const count = people.length;
      total += count;
      console.log(`  │ ${stage.padEnd(18)} │ ${String(count).padStart(5)} │`);
    } catch {
      console.log(`  │ ${stage.padEnd(18)} │   err │`);
    }
  }

  console.log('  ├────────────────────┼───────┤');
  console.log(`  │ TOTAL              │ ${String(total).padStart(5)} │`);
  console.log('  └────────────────────┴───────┘');

  // Per-test A/B breakdown
  await printTestReport();
}

async function printTestReport() {
  // Load all contacts with a test name
  const filter = { and: [{ abTestName: { neq: '' } }] };
  let people;
  try {
    people = await paginateAll('people', filter);
  } catch {
    return; // Field may not exist yet
  }
  if (people.length === 0) return;

  // Group by test name
  const byTest = {};
  for (const p of people) {
    const test = p.abTestName || '';
    if (!test) continue;
    if (!byTest[test]) byTest[test] = [];
    byTest[test].push(p);
  }

  const testNames = Object.keys(byTest).sort();
  if (testNames.length === 0) return;

  console.log('\n  A/B TEST RESULTS:');
  for (const test of testNames) {
    const contacts = byTest[test];

    // Group by campaignLabel for per-label breakdown
    const byLabel = {};
    for (const p of contacts) {
      const label = p.campaignLabel || `${(p.icpTier || '?')}_${p.abVariant || '?'}`;
      if (!byLabel[label]) byLabel[label] = [];
      byLabel[label].push(p);
    }

    const labels = Object.keys(byLabel).sort();

    console.log(`\n  Test: "${test}" (${contacts.length} contacts)`);
    console.log('  ┌──────────────────────────────┬──────┬────────┬─────────┬─────────┬─────────┐');
    console.log('  │ Campaign Label               │ Sent │ Opened │ Replied │ Bounced │ Open  % │');
    console.log('  ├──────────────────────────────┼──────┼────────┼─────────┼─────────┼─────────┤');

    for (const label of labels) {
      const group = byLabel[label];
      const sent = group.length;
      const opened = group.filter((p) => ['opened', 'replied', 'opened_no_reply'].includes(p.funnelStage)).length;
      const replied = group.filter((p) => ['replied', 'replied_went_cold'].includes(p.funnelStage)).length;
      const bounced = group.filter((p) => p.funnelStage === 'bounced').length;
      const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0.0';

      console.log(`  │ ${label.padEnd(28)} │ ${String(sent).padStart(4)} │ ${String(opened).padStart(6)} │ ${String(replied).padStart(7)} │ ${String(bounced).padStart(7)} │ ${openRate.padStart(5)}%  │`);
    }
    console.log('  └──────────────────────────────┴──────┴────────┴─────────┴─────────┴─────────┘');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SYNC STATUS — Instantly -> Twenty CRM');
  console.log('═══════════════════════════════════════════════════════════');

  if (runOnce) {
    await syncOnce();
    return;
  }

  // Loop mode
  console.log(`  Running in loop mode (every ${POLL_INTERVAL_MS / 60000} minutes)`);
  console.log('  Press Ctrl+C to stop\n');

  while (true) {
    try {
      await syncOnce();
    } catch (err) {
      log.error('Sync error', { error: err.message });
    }
    console.log(`\n  Next sync in ${POLL_INTERVAL_MS / 60000} minutes...`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
