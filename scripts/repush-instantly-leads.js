#!/usr/bin/env node

/**
 * Re-push leads to Instantly campaigns via v1 /lead/add endpoint.
 *
 * The v2 POST /leads endpoint silently drops campaign_id. The v1 /lead/add
 * endpoint (used by Instantly's own UI) properly associates leads with campaigns.
 *
 * Usage:
 *   node scripts/repush-instantly-leads.js [--dry-run] [--test subject_v1]
 *   node scripts/repush-instantly-leads.js --campaign hot_A_subject_v1 --limit 10
 */

import { getEnv, withRetry } from './lib/twenty-client.js';
import { buildCampaignLabel } from './lib/constants.js';
import { getAllLeads, initDb } from './lib/db.js';
import { isLeadRepushable } from './lib/lead-policy.js';

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) { return args.includes(flag); }

const dryRun = hasFlag('--dry-run');
const limitArg = getArg('--limit');
const campaignFilter = getArg('--campaign');
const testName = getArg('--test') || 'subject_v1';

// ---------------------------------------------------------------------------
// Instantly v1 API (lead/add) + v2 API (campaigns)
// ---------------------------------------------------------------------------

const INSTANTLY_V1_BASE = 'https://api.instantly.ai/api/v1';
const INSTANTLY_V2_BASE = 'https://api.instantly.ai/api/v2';

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

async function v2Fetch(method, path) {
  const apiKey = getEnv('INSTANTLY_API_KEY');
  const response = await fetch(`${INSTANTLY_V2_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`v2 ${method} ${path}: ${response.status} ${text}`);
  }
  return response.json();
}

async function v1CampaignSummary(campaignId) {
  const orgAuth = getEnv('INSTANTLY_ORG_AUTH');
  const response = await fetch(
    `${INSTANTLY_V1_BASE}/analytics/campaign/summary?campaign_id=${encodeURIComponent(campaignId)}`,
    { headers: { 'x-org-auth': orgAuth } },
  );
  if (!response.ok) return null;
  return response.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RE-PUSH LEADS TO INSTANTLY (v1 /lead/add)');
  console.log('═══════════════════════════════════════════════════════════');

  // 1. Fetch campaign name→ID map from Instantly
  console.log('\n  Fetching campaigns from Instantly...');
  const campaignsResult = await v2Fetch('GET', '/campaigns?limit=100');
  const campaigns = campaignsResult?.items || [];
  const campaignMap = new Map();
  for (const c of campaigns) {
    if (c.name && c.id) campaignMap.set(c.name, c.id);
  }
  console.log(`  Found ${campaignMap.size} campaigns`);

  // 2. Load repushable leads from SQLite
  initDb();
  console.log('\n  Loading repushable leads from SQLite...');
  const allPeople = getAllLeads();
  const contacted = allPeople.filter((p) => isLeadRepushable(p));
  const blocked = allPeople.length - contacted.length;
  console.log(`  Total repushable: ${contacted.length}`);
  console.log(`  Blocked by suppression policy: ${blocked}`);

  // 3. Route each lead to its campaign
  const byCampaign = new Map(); // campaignId -> { name, leads[] }
  const unrouted = [];

  for (const person of contacted) {
    const email = person.emails?.primaryEmail || '';
    if (!email) continue;

    const tier = (person.icpTier || '').toLowerCase();
    const variant = (person.abVariant || '').toUpperCase();
    if (!tier || !variant) {
      unrouted.push({ email, reason: `missing tier=${tier} or variant=${variant}` });
      continue;
    }

    // Determine test name for campaign label
    let effectiveTest = testName;
    if (variant === 'C') effectiveTest = 'nurture_v1';
    if (variant === 'D') effectiveTest = 'followup_v1';

    const label = buildCampaignLabel(tier, variant, effectiveTest);
    const campaignId = campaignMap.get(label);

    if (!campaignId) {
      unrouted.push({ email, reason: `no campaign "${label}"` });
      continue;
    }

    if (campaignFilter && label !== campaignFilter) continue;

    if (!byCampaign.has(campaignId)) {
      byCampaign.set(campaignId, { name: label, leads: [] });
    }

    byCampaign.get(campaignId).leads.push({
      email,
      first_name: person.name?.firstName || '',
      last_name: person.name?.lastName || '',
      company_name: person.company?.name || '',
      custom_variables: {
        icp_score: String(person.icpScore || ''),
        icp_tier: person.icpTier || '',
        hook_text: person.hookText || '',
        hook_source: person.hookSource || '',
        ig_username: person.igUsername || '',
        ig_followers: String(person.igFollowers || ''),
        linkedin_headline: person.linkedinHeadline || '',
        linkedin_recent_topic: person.linkedinRecentTopic || '',
        region: person.region || '',
        personalized_subject: person.personalizedSubject || '',
        personalized_hook: person.personalizedHook || person.hookText || '',
      },
    });
  }

  // Apply limit
  if (limitArg) {
    const limit = parseInt(limitArg, 10);
    for (const [cid, group] of byCampaign) {
      group.leads = group.leads.slice(0, limit);
    }
  }

  // 4. Report routing
  let totalLeads = 0;
  console.log('\n  Campaign routing:');
  console.log('  ┌──────────────────────────────┬───────┐');
  console.log('  │ Campaign                      │ Leads │');
  console.log('  ├──────────────────────────────┼───────┤');
  for (const [cid, { name, leads }] of byCampaign) {
    console.log(`  │ ${name.padEnd(28)} │ ${String(leads.length).padStart(5)} │`);
    totalLeads += leads.length;
  }
  console.log('  ├──────────────────────────────┼───────┤');
  console.log(`  │ TOTAL                         │ ${String(totalLeads).padStart(5)} │`);
  console.log('  └──────────────────────────────┴───────┘');

  if (unrouted.length > 0) {
    console.log(`\n  Unrouted: ${unrouted.length} leads`);
    const reasons = {};
    for (const u of unrouted) {
      reasons[u.reason] = (reasons[u.reason] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`    ${count}x: ${reason}`);
    }
  }

  if (dryRun) {
    console.log('\n  DRY RUN — no API calls made');
    return;
  }

  // 5. Push leads to campaigns in bulk (v1 supports arrays)
  console.log('\n  Pushing leads to Instantly (v1 /lead/add)...');

  const CHUNK_SIZE = 100; // v1 supports bulk, but chunk for safety
  let totalPushed = 0;
  let totalErrors = 0;

  for (const [campaignId, { name, leads }] of byCampaign) {
    console.log(`\n  Campaign: ${name} (${leads.length} leads)`);

    for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
      const chunk = leads.slice(i, i + CHUNK_SIZE);
      try {
        const result = await withRetry(async () => {
          return v1LeadAdd(chunk, campaignId);
        }, 2, [3000, 10000]);

        const uploaded = result.leads_uploaded || 0;
        const skipped = result.already_in_campaign || 0;
        totalPushed += uploaded;
        console.log(`    Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${uploaded} uploaded, ${skipped} already in campaign`);
      } catch (err) {
        console.error(`    Chunk ${Math.floor(i / CHUNK_SIZE) + 1} FAILED: ${err.message}`);
        totalErrors += chunk.length;
      }
    }

    // Verify campaign is active
    const summary = await v1CampaignSummary(campaignId);
    if (summary) {
      console.log(`    Campaign stats: ${summary.stats_leads_total} total, ${summary.stats_status_active} active`);
    }
  }

  // 6. Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RE-PUSH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total pushed: ${totalPushed}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Campaigns: ${byCampaign.size}`);
  if (unrouted.length > 0) {
    console.log(`  Unrouted (skipped): ${unrouted.length}`);
  }
  console.log('\n  Next: check Instantly UI to verify campaigns are active and sending.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
