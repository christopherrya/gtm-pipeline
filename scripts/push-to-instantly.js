#!/usr/bin/env node

/**
 * Push to Instantly — Send batch CSV leads to Instantly campaigns
 *
 * Reads a batch CSV (from prepare-batch.js), assigns inboxes from the shared
 * pool (lowest daily send count), pushes to the correct Instantly campaign,
 * and updates Twenty CRM with campaign ID + assigned inbox.
 *
 * Inbox routing:
 *   - All 6 inboxes send to all regions (shared pool, no per-region lock)
 *   - Each lead is assigned the inbox with the lowest daily send count
 *   - assignedInbox is stored in Twenty so nurture (Campaign C) reuses the same sender
 *   - A contact is never sent from two different inboxes across campaigns
 *
 * Usage:
 *   node scripts/push-to-instantly.js <csv> [--campaign-a ID] [--campaign-b ID] [--campaign-c ID] [--dry-run]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'csv-parse/sync';
import {
  hasTwentyConfig,
  batchUpdate,
  getEnv,
  withRetry,
  toInt,
} from './lib/twenty-client.js';
import { BATCH_SIZE, getInboxPool, buildCampaignLabel } from './lib/constants.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const csvPath = args.find((a) => !a.startsWith('-'));
const campaignA = getArg('--campaign-a') || getEnv('INSTANTLY_CAMPAIGN_A');
const campaignB = getArg('--campaign-b') || getEnv('INSTANTLY_CAMPAIGN_B');
const campaignC = getArg('--campaign-c') || getEnv('INSTANTLY_CAMPAIGN_C');
const campaignD = getArg('--campaign-d') || getEnv('INSTANTLY_CAMPAIGN_D');
const dryRun = hasFlag('--dry-run');

if (!csvPath) {
  console.error('Usage: node scripts/push-to-instantly.js <csv> [--campaign-a ID] [--campaign-b ID] [--campaign-c ID] [--campaign-d ID] [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Instantly v2 API client
// ---------------------------------------------------------------------------

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';

async function instantlyFetch(method, path, body) {
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

  const response = await fetch(`${INSTANTLY_BASE}${path}`, opts);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly API ${method} ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function pushLeadsToCampaign(campaignId, leads) {
  const results = { pushed: 0, errors: 0 };
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const chunk = leads.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((lead) => ({
      email: lead.email,
      first_name: lead.first_name,
      last_name: lead.last_name,
      company_name: lead.company_name,
      assigned_sender: lead._assignedInbox || undefined,
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
      await withRetry(async () => {
        await instantlyFetch('POST', '/leads', {
          campaign_id: campaignId,
          leads: payload,
        });
      }, 2, [3000, 10000]);
      results.pushed += chunk.length;
    } catch (err) {
      console.error(`  Error pushing batch to campaign ${campaignId}: ${err.message}`);
      results.errors += chunk.length;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Inbox routing — shared pool, lowest daily send count
// ---------------------------------------------------------------------------

function assignInboxes(rows, inboxPool, isNurture) {
  // Track send count per inbox for this batch
  const sendCounts = new Map();
  for (const inbox of inboxPool) {
    sendCounts.set(inbox, 0);
  }

  for (const row of rows) {
    if (isNurture && row.assignedInbox) {
      // Nurture: reuse the inbox from the first touch sequence
      row._assignedInbox = row.assignedInbox;
      const count = sendCounts.get(row.assignedInbox);
      if (count !== undefined) sendCounts.set(row.assignedInbox, count + 1);
    } else {
      // First touch: assign inbox with lowest send count
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse CSV first to detect mode
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
  console.log(`  Loaded ${rows.length} leads`);

  // Split by variant
  const leadsA = rows.filter((r) => r.abVariant === 'A');
  const leadsB = rows.filter((r) => r.abVariant === 'B');
  const leadsC = rows.filter((r) => r.abVariant === 'C');
  const leadsD = rows.filter((r) => r.abVariant === 'D');

  // Validate campaign IDs based on mode
  if (isSoftFollowup) {
    if (!campaignD) {
      console.error('Error: Campaign D ID required for soft follow-up. Set INSTANTLY_CAMPAIGN_D in .env or pass --campaign-d');
      process.exit(1);
    }
    console.log(`  Campaign D (soft follow-up): ${leadsD.length} leads -> Campaign ${campaignD}`);
  } else if (isNurture) {
    if (!campaignC) {
      console.error('Error: Campaign C ID required for nurture. Set INSTANTLY_CAMPAIGN_C in .env or pass --campaign-c');
      process.exit(1);
    }
    console.log(`  Campaign C (nurture): ${leadsC.length} leads -> Campaign ${campaignC}`);
  } else {
    if (!campaignA || !campaignB) {
      console.error('Error: Campaign A/B IDs required. Set INSTANTLY_CAMPAIGN_A/B in .env or pass --campaign-a/--campaign-b');
      process.exit(1);
    }
    console.log(`  Variant A: ${leadsA.length} leads -> Campaign ${campaignA}`);
    console.log(`  Variant B: ${leadsB.length} leads -> Campaign ${campaignB}`);
  }

  // Inbox routing
  const inboxPool = getInboxPool();
  let sendCounts;
  if (inboxPool.length > 0) {
    console.log(`\n  Inbox pool: ${inboxPool.length} inboxes`);
    sendCounts = assignInboxes(rows, inboxPool, isNurture || isSoftFollowup);

    console.log('  Inbox distribution:');
    for (const [inbox, count] of sendCounts) {
      const short = inbox.split('@')[0];
      console.log(`    ${short}: ${count} leads`);
    }
  } else {
    console.log('\n  INSTANTLY_INBOXES not set — Instantly will auto-distribute across sender accounts');
  }

  if (dryRun) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  DRY RUN — No API calls made');
    console.log('═══════════════════════════════════════════════════════════');
    if (isSoftFollowup) {
      console.log(`  Would push ${leadsD.length} leads to Campaign D (soft follow-up)`);
      const reused = leadsD.filter((r) => r.assignedInbox).length;
      console.log(`  Inbox reuse (from prior sequence): ${reused}/${leadsD.length}`);
    } else if (isNurture) {
      console.log(`  Would push ${leadsC.length} leads to Campaign C (nurture)`);
      const reused = leadsC.filter((r) => r.assignedInbox).length;
      console.log(`  Inbox reuse (from first touch): ${reused}/${leadsC.length}`);
    } else {
      console.log(`  Would push ${leadsA.length} leads to Campaign A`);
      console.log(`  Would push ${leadsB.length} leads to Campaign B`);
    }
    console.log(`  Would update ${rows.length} People in Twenty CRM`);
    return;
  }

  // Check Instantly API key
  if (!getEnv('INSTANTLY_API_KEY')) {
    console.error('Error: INSTANTLY_API_KEY must be set in .env');
    process.exit(1);
  }

  // Push to Instantly
  const results = {};
  if (isSoftFollowup) {
    console.log('\n  Pushing to Instantly Campaign D (soft follow-up)...');
    results.D = await pushLeadsToCampaign(campaignD, leadsD);
    console.log(`  Campaign D: ${results.D.pushed} pushed, ${results.D.errors} errors`);
  } else if (isNurture) {
    console.log('\n  Pushing to Instantly Campaign C (nurture)...');
    results.C = await pushLeadsToCampaign(campaignC, leadsC);
    console.log(`  Campaign C: ${results.C.pushed} pushed, ${results.C.errors} errors`);
  } else {
    console.log('\n  Pushing to Instantly Campaign A...');
    results.A = await pushLeadsToCampaign(campaignA, leadsA);
    console.log(`  Campaign A: ${results.A.pushed} pushed, ${results.A.errors} errors`);

    console.log('  Pushing to Instantly Campaign B...');
    results.B = await pushLeadsToCampaign(campaignB, leadsB);
    console.log(`  Campaign B: ${results.B.pushed} pushed, ${results.B.errors} errors`);
  }

  // Update Twenty CRM
  if (hasTwentyConfig()) {
    console.log('\n  Updating Twenty CRM...');
    const now = new Date().toISOString();
    const inboundDomain = getEnv('GTM_INBOUND_DOMAIN', 'inbound.discloser.co');

    function campaignIdForRow(r) {
      if (r.abVariant === 'D') return campaignD;
      if (r.abVariant === 'C') return campaignC;
      return r.abVariant === 'A' ? campaignA : campaignB;
    }

    const targetStage = isSoftFollowup ? 'contacted' : isNurture ? 'nurture' : 'contacted';

    // Detect test name from CSV (all rows share the same test)
    const batchTestName = rows.find((r) => r.testName)?.testName || '';

    // Build campaign map: campaign ID -> set of labels
    const campaignMap = new Map();

    const updates = rows
      .filter((r) => r.twentyId)
      .map((r) => {
        const label = buildCampaignLabel(r.icp_tier, r.abVariant, batchTestName);
        const cid = campaignIdForRow(r);

        // Track for campaign map output
        if (!campaignMap.has(cid)) campaignMap.set(cid, new Set());
        campaignMap.get(cid).add(label);

        const update = {
          id: r.twentyId,
          funnelStage: targetStage,
          lastOutreachDate: now,
          instantlyCampaignId: cid,
          outreachStatus: 'sent',
          abVariant: r.abVariant,
          assignedInbox: r._assignedInbox || '',
          campaignLabel: label,
        };
        // Set firstContactedAt only on first touch (don't overwrite on nurture/followup)
        if (!isNurture && !isSoftFollowup) {
          update.firstContactedAt = now;
        }
        if (batchTestName) {
          update.abTestName = batchTestName;
        }
        // Only set replyToAddress on first touch, nurture reuses existing
        if (!isNurture) {
          update.replyToAddress = `disclosure-${crypto.randomUUID()}@${inboundDomain}`;
        }
        return update;
      });

    const updateResult = await batchUpdate('people', updates);
    console.log(`  Twenty updated: ${updateResult.updated}, Errors: ${updateResult.errors}`);
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PUSH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  if (isSoftFollowup) {
    console.log(`  Instantly Campaign D (soft follow-up): ${results.D.pushed} contacts added`);
    console.log(`\n  Twenty CRM updates:`);
    console.log(`    funnelStage -> 'contacted': ${rows.filter((r) => r.twentyId).length}`);
  } else if (isNurture) {
    console.log(`  Instantly Campaign C (nurture): ${results.C.pushed} contacts added`);
    console.log(`\n  Twenty CRM updates:`);
    console.log(`    funnelStage -> 'nurture': ${rows.filter((r) => r.twentyId).length}`);
  } else {
    console.log(`  Instantly Campaign A: ${results.A.pushed} contacts added`);
    console.log(`  Instantly Campaign B: ${results.B.pushed} contacts added`);
    console.log(`\n  Twenty CRM updates:`);
    console.log(`    funnelStage -> 'contacted': ${rows.filter((r) => r.twentyId).length}`);
    console.log(`    abVariant set: ${rows.length} (A: ${leadsA.length}, B: ${leadsB.length})`);
  }
  console.log(`    lastOutreachDate set: ${rows.filter((r) => r.twentyId).length}`);
  console.log(`    instantlyCampaignId set: ${rows.filter((r) => r.twentyId).length}`);
  console.log(`    assignedInbox set: ${rows.filter((r) => r._assignedInbox).length}`);
  const pushTestName = rows.find((r) => r.testName)?.testName;
  if (pushTestName) {
    console.log(`    abTestName: "${pushTestName}"`);
  }

  // Print campaign map — match Instantly campaign IDs to labels
  if (campaignMap && campaignMap.size > 0) {
    console.log('\n  CAMPAIGN MAP (name your Instantly campaigns to match):');
    console.log('  ┌──────────────────────────────────────┬──────────────────────────────┐');
    console.log('  │ Campaign ID                          │ Labels                       │');
    console.log('  ├──────────────────────────────────────┼──────────────────────────────┤');
    for (const [cid, labels] of campaignMap) {
      const labelStr = [...labels].sort().join(', ');
      const shortId = cid.length > 36 ? cid.slice(0, 33) + '...' : cid;
      console.log(`  │ ${shortId.padEnd(36)} │ ${labelStr.padEnd(28)} │`);
    }
    console.log('  └──────────────────────────────────────┴──────────────────────────────┘');
  }

  if (inboxPool.length > 0) {
    console.log('\n  INBOX UTILIZATION:');
    console.log('  ┌─────────────────────────┬───────┐');
    console.log('  │ Inbox                   │ Sends │');
    console.log('  ├─────────────────────────┼───────┤');
    for (const [inbox, count] of sendCounts) {
      console.log(`  │ ${inbox.padEnd(23)} │ ${String(count).padStart(5)} │`);
    }
    console.log('  └─────────────────────────┴───────┘');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
