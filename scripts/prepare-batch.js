#!/usr/bin/env node

/**
 * Prepare Batch — Select leads from Twenty CRM for outreach
 *
 * Queries Twenty by region/ICP/tier, applies suppression, assigns A/B variants,
 * outputs a send-ready CSV, and marks selected contacts as 'queued'.
 *
 * Usage:
 *   node scripts/prepare-batch.js --region "SF Bay" --min-score 50 [--tier hot,high] [--limit 500] [--dry-run]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stringify } from 'csv-stringify/sync';
import {
  hasTwentyConfig,
  paginateAll,
  batchUpdate,
  hash,
  toInt,
} from './lib/twenty-client.js';
import {
  SUPPRESSED_STAGES, COOLDOWN_DAYS, SEQUENCE_DURATION_DAYS,
  icpTier, rampBatchLimit, isReEngageEligible,
} from './lib/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const region = getArg('--region');
const mode = getArg('--mode') || 'first_touch'; // 'first_touch', 'nurture', or 'soft_followup'
const testName = getArg('--test'); // e.g. "subject_line_v2", "value_prop_test"
const minScore = toInt(getArg('--min-score'), mode === 'first_touch' ? 50 : 0);
const tierFilter = getArg('--tier') ? getArg('--tier').split(',').map((t) => t.trim().toLowerCase()) : null;
const campaignStart = getArg('--campaign-start'); // ISO date, e.g. "2026-03-10"
const explicitLimit = getArg('--limit');
const limit = explicitLimit ? toInt(explicitLimit) : rampBatchLimit(campaignStart);
const dryRun = hasFlag('--dry-run');

if (!region) {
  console.error('Usage: node scripts/prepare-batch.js --region "SF Bay" --min-score 50 [--test subject_line_v2] [--mode nurture] [--tier hot,high] [--limit 500] [--campaign-start 2026-03-10] [--dry-run]');
  process.exit(1);
}
if (!['first_touch', 'nurture', 'soft_followup'].includes(mode)) {
  console.error('Error: --mode must be "first_touch", "nurture", or "soft_followup"');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mode-specific queries
// ---------------------------------------------------------------------------

async function prepareFirstTouchBatch() {
  console.log('\n  Querying Twenty for scored contacts...');
  const filter = { and: [{ funnelStage: { eq: 'scored' } }] };
  const allPeople = await paginateAll('people', filter);
  console.log(`  Found ${allPeople.length} contacts with funnelStage='scored'`);

  let candidates = allPeople.filter((p) => {
    const pRegion = p.region || '';
    if (pRegion !== region) return false;
    const score = toInt(p.icpScore);
    if (score < minScore) return false;
    if (tierFilter) {
      const tier = (p.icpTier || icpTier(score)).toLowerCase();
      if (!tierFilter.includes(tier)) return false;
    }
    return true;
  });
  console.log(`  After region/score/tier filter: ${candidates.length}`);

  let suppressedCount = 0;
  let testDupCount = 0;
  const now = Date.now();
  candidates = candidates.filter((p) => {
    if (SUPPRESSED_STAGES.includes(p.funnelStage)) {
      suppressedCount++;
      return false;
    }
    if (p.lastOutreachDate) {
      const lastDate = new Date(p.lastOutreachDate).getTime();
      if (!isNaN(lastDate) && (now - lastDate) / 86400000 < COOLDOWN_DAYS) {
        suppressedCount++;
        return false;
      }
    }
    // Prevent re-entering the same A/B test
    if (testName && p.abTestHistory) {
      const history = p.abTestHistory.split(',').map((s) => s.trim());
      if (history.includes(testName)) {
        testDupCount++;
        return false;
      }
    }
    return true;
  });
  console.log(`  Suppressed: ${suppressedCount}`);
  if (testDupCount > 0) console.log(`  Already in test "${testName}": ${testDupCount}`);
  console.log(`  Eligible: ${candidates.length}`);

  return { candidates, suppressedCount };
}

async function prepareNurtureBatch() {
  // Nurture mode: find opened_no_reply contacts past their cooldown
  console.log('\n  Querying Twenty for opened-no-reply contacts (nurture candidates)...');
  const filter = { and: [{ funnelStage: { eq: 'opened_no_reply' } }] };
  const allPeople = await paginateAll('people', filter);
  console.log(`  Found ${allPeople.length} contacts with funnelStage='opened_no_reply'`);

  // Filter: must be past the 14-21 day cooldown and in the right region
  const candidates = allPeople.filter((p) => {
    const pRegion = p.region || '';
    if (pRegion !== region) return false;
    // Check cooldown: lastOutreachDate must be >14 days ago
    if (!isReEngageEligible('opened_no_reply', p.lastOutreachDate, toInt(p.reEngageAttempts))) {
      return false;
    }
    return true;
  });
  console.log(`  Past cooldown + in region: ${candidates.length}`);

  return candidates;
}

async function prepareSoftFollowupBatch() {
  // Campaign D: find replied_went_cold contacts past their cooldown
  console.log('\n  Querying Twenty for replied-went-cold contacts (Campaign D candidates)...');
  const filter = { and: [{ funnelStage: { eq: 'replied_went_cold' } }] };
  const allPeople = await paginateAll('people', filter);
  console.log(`  Found ${allPeople.length} contacts with funnelStage='replied_went_cold'`);

  const candidates = allPeople.filter((p) => {
    const pRegion = p.region || '';
    if (pRegion !== region) return false;
    if (!isReEngageEligible('replied_went_cold', p.lastOutreachDate, toInt(p.reEngageAttempts))) {
      return false;
    }
    return true;
  });
  console.log(`  Past cooldown + in region: ${candidates.length}`);

  return candidates;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const modeLabels = {
    first_touch: 'FIRST TOUCH (A/B)',
    nurture: 'NURTURE (Campaign C)',
    soft_followup: 'SOFT FOLLOW-UP (Campaign D)',
  };
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PREPARE BATCH — ${modeLabels[mode]}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (!hasTwentyConfig()) {
    console.error('Error: TWENTY_BASE_URL and TWENTY_API_KEY must be set in .env');
    process.exit(1);
  }

  let candidates;
  let suppressedCount = 0;
  const now = Date.now();

  if (mode === 'nurture') {
    candidates = await prepareNurtureBatch();
  } else if (mode === 'soft_followup') {
    candidates = await prepareSoftFollowupBatch();
  } else {
    const result = await prepareFirstTouchBatch();
    candidates = result.candidates;
    suppressedCount = result.suppressedCount;
  }

  // Sort by ICP score descending
  candidates.sort((a, b) => toInt(b.icpScore) - toInt(a.icpScore));

  // Apply limit
  if (limit > 0 && candidates.length > limit) {
    candidates = candidates.slice(0, limit);
    console.log(`  Limited to: ${candidates.length}`);
  }

  if (candidates.length === 0) {
    console.log('\n  No contacts eligible for this batch. Exiting.');
    return;
  }

  // Tier breakdown
  const tierBreakdown = {};
  for (const p of candidates) {
    const tier = (p.icpTier || 'unknown');
    tierBreakdown[tier] = (tierBreakdown[tier] || 0) + 1;
  }

  let variantA = 0;
  let variantB = 0;

  if (mode === 'nurture') {
    // Nurture mode: no A/B split, all go to Campaign C
    for (const p of candidates) {
      p._abVariant = 'C';
    }
  } else if (mode === 'soft_followup') {
    // Campaign D: single email, all go to variant D
    for (const p of candidates) {
      p._abVariant = 'D';
    }
  } else {
    // First touch: A/B assignment via deterministic hash
    const salt = new Date().toISOString().slice(0, 10);
    for (const p of candidates) {
      const email = p.emails?.primaryEmail || '';
      const variant = parseInt(hash(`${email}|${salt}`).slice(0, 8), 16) % 2 === 0 ? 'A' : 'B';
      p._abVariant = variant;
      if (variant === 'A') variantA++;
      else variantB++;
    }
  }

  // Generate CSV rows
  const csvRows = candidates.map((p) => ({
    email: p.emails?.primaryEmail || '',
    first_name: p.name?.firstName || '',
    last_name: p.name?.lastName || '',
    company_name: p.company || '',
    icp_score: toInt(p.icpScore),
    icp_tier: p.icpTier || '',
    hook_text: p.hookText || '',
    hook_source: p.hookSource || '',
    ig_username: p.igUsername || '',
    ig_followers: toInt(p.igFollowers),
    linkedin_headline: p.linkedinHeadline || '',
    linkedin_recent_topic: p.linkedinRecentTopic || '',
    linkedin_days_since_post: toInt(p.linkedinDaysSincePost, 999),
    ig_recent_addresses: p.igRecentAddresses || '',
    ig_neighborhoods: p.igNeighborhoods || '',
    ig_days_since_post: toInt(p.igDaysSincePost, 999),
    ig_listing_posts: toInt(p.igListingPostsCount),
    ig_sold_posts: toInt(p.igSoldPostsCount),
    region: p.region || '',
    abVariant: p._abVariant,
    assignedInbox: p.assignedInbox || '', // carry forward for nurture inbox reuse
    mode,
    testName: testName || '',
    twentyId: p.id,
  }));

  // Write CSV
  const date = new Date().toISOString().slice(0, 10);
  const regionSlug = region.toLowerCase().replace(/\s+/g, '_');
  const modeSlugs = { first_touch: 'batch', nurture: 'nurture', soft_followup: 'followup' };
  const modeSlug = modeSlugs[mode] || 'batch';
  const testSlug = testName ? `_${testName.replace(/\s+/g, '_')}` : '';
  const outputDir = join(__dirname, 'output');
  mkdirSync(outputDir, { recursive: true });
  const csvPath = join(outputDir, `${modeSlug}_${regionSlug}${testSlug}_${date}.csv`);
  writeFileSync(csvPath, stringify(csvRows, { header: true }));

  // Update Twenty
  if (!dryRun) {
    const targetStages = { first_touch: 'queued', nurture: 'nurture', soft_followup: 'queued' };
    const targetStage = targetStages[mode] || 'queued';
    console.log(`\n  Updating Twenty CRM — marking contacts as '${targetStage}'...`);
    const updates = candidates.map((p) => {
      const update = {
        id: p.id,
        funnelStage: targetStage,
        abVariant: p._abVariant,
      };
      if (testName) {
        update.abTestName = testName;
        // Append to history (comma-separated list of all tests this contact has been in)
        const existing = (p.abTestHistory || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!existing.includes(testName)) existing.push(testName);
        update.abTestHistory = existing.join(',');
      }
      return update;
    });
    const result = await batchUpdate('people', updates);
    console.log(`  Updated: ${result.updated}, Errors: ${result.errors}`);
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  BATCH PREPARED — ${candidates.length} contacts selected`);
  console.log('═══════════════════════════════════════════════════════════');
  const limitSource = explicitLimit ? `manual (--limit ${explicitLimit})` : `ramp auto (${limit}/week)`;
  console.log(`  Mode: ${modeLabels[mode]}${testName ? ` | Test: "${testName}"` : ''}`);
  console.log(`  Region: ${region} | Min Score: ${minScore} | Tier filter: ${tierFilter ? tierFilter.join(', ') : 'all'}`);
  console.log(`  Batch limit: ${limit} — ${limitSource}`);

  if (mode === 'nurture') {
    console.log(`\n  Campaign C: ${candidates.length} contacts (all nurture)`);
  } else if (mode === 'soft_followup') {
    console.log(`\n  Campaign D: ${candidates.length} contacts (soft follow-up, 1 email)`);
  } else {
    console.log(`\n  A/B Split:`);
    console.log(`    Variant A: ${variantA} contacts`);
    console.log(`    Variant B: ${variantB} contacts`);
  }
  console.log(`\n  Tier breakdown:`);
  for (const [tier, count] of Object.entries(tierBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tier}: ${count}`);
  }
  console.log(`\n  Suppressed: ${suppressedCount}`);
  if (dryRun) {
    console.log('  DRY RUN — Twenty not updated');
  } else {
    const summaryStages = { first_touch: 'queued', nurture: 'nurture', soft_followup: 'queued' };
    console.log(`  Twenty CRM updated: ${candidates.length} People -> funnelStage: '${summaryStages[mode] || 'queued'}'`);
  }
  console.log(`  CSV written to: ${csvPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
