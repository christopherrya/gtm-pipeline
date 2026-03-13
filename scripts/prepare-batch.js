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
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { stringify } from 'csv-stringify/sync';
import {
  toInt,
} from './lib/twenty-client.js';
import {
  icpTier, rampBatchLimit, isReEngageEligible,
} from './lib/constants.js';
import { createLogger } from './lib/logger.js';
import { initDb, findLeadsByStage, updateLeads } from './lib/db.js';
import { assignAbVariant, getSuppressionReason } from './lib/lead-policy.js';

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
// Mode-specific queries
// ---------------------------------------------------------------------------

async function prepareFirstTouchBatch(region, minScore, tierFilter, testName, log) {
  log.info('Querying SQLite for scored contacts');
  const allPeople = findLeadsByStage('scored');
  log.info('Scored contacts found', { count: allPeople.length });

  let candidates = allPeople.filter((p) => {
    if (region) {
      const pRegion = p.region || '';
      if (pRegion !== region) return false;
    }
    const score = toInt(p.icpScore);
    if (score < minScore) return false;
    if (tierFilter) {
      const tier = (p.icpTier || icpTier(score)).toLowerCase();
      if (!tierFilter.includes(tier)) return false;
    }
    return true;
  });
  log.info('After region/score/tier filter', { count: candidates.length });

  let suppressedCount = 0;
  let testDupCount = 0;
  let staleCount = 0;
  const now = Date.now();
  candidates = candidates.filter((p) => {
    const reason = getSuppressionReason(p, { mode: 'first_touch', region, minScore, tierFilter, testName, now });
    if (!reason) return true;
    if (reason === 'test_dup') testDupCount++;
    else if (reason === 'stale_enrichment') staleCount++;
    else suppressedCount++;
    return false;
  });
  if (staleCount > 0) {
    log.warn('Stale leads skipped — enrichment too old', { staleCount });
    console.warn(`\n  ⚠ ${staleCount} leads skipped: enrichment is older than 2 days.`);
    console.warn(`    They remain 'scored' and will be re-enriched on the next full pipeline run.\n`);
  }
  log.info('Suppression applied', { suppressed: suppressedCount, testDups: testDupCount, staleCount, eligible: candidates.length });

  return { candidates, suppressedCount, staleCount };
}

async function prepareNurtureBatch(region, log) {
  log.info('Querying SQLite for opened-no-reply contacts (nurture candidates)');
  const allPeople = findLeadsByStage('opened_no_reply');
  log.info('Opened-no-reply contacts found', { count: allPeople.length });

  const candidates = allPeople.filter((p) => {
    if (region) {
      const pRegion = p.region || '';
      if (pRegion !== region) return false;
    }
    if (!isReEngageEligible('opened_no_reply', p.lastOutreachDate, toInt(p.reEngageAttempts))) {
      return false;
    }
    return true;
  });
  log.info('Past cooldown + in region', { count: candidates.length });

  return candidates;
}

async function prepareSoftFollowupBatch(region, log) {
  log.info('Querying SQLite for replied-went-cold contacts (Campaign D candidates)');
  const allPeople = findLeadsByStage('replied_went_cold');
  log.info('Replied-went-cold contacts found', { count: allPeople.length });

  const candidates = allPeople.filter((p) => {
    if (region) {
      const pRegion = p.region || '';
      if (pRegion !== region) return false;
    }
    if (!isReEngageEligible('replied_went_cold', p.lastOutreachDate, toInt(p.reEngageAttempts))) {
      return false;
    }
    return true;
  });
  log.info('Past cooldown + in region', { count: candidates.length });

  return candidates;
}

// ---------------------------------------------------------------------------
// Main (exported for programmatic use)
// ---------------------------------------------------------------------------

export async function main(opts = {}) {
  const region = opts.region || getArg('--region');
  const mode = opts.mode || getArg('--mode') || 'first_touch';
  const testName = opts.testName || getArg('--test');
  const minScore = opts.minScore ?? toInt(getArg('--min-score'), mode === 'first_touch' ? 50 : 0);
  const tierFilter = opts.tierFilter || (getArg('--tier') ? getArg('--tier').split(',').map((t) => t.trim().toLowerCase()) : null);
  const campaignStart = opts.campaignStart || getArg('--campaign-start');
  const explicitLimit = opts.limit != null ? String(opts.limit) : getArg('--limit');
  const limit = explicitLimit ? toInt(explicitLimit) : rampBatchLimit(campaignStart);
  const dryRun = opts.dryRun ?? hasFlag('--dry-run');
  const log = opts.log || createLogger({ step: 'prepare' });

  // Region is optional — when omitted, all regions are included
  if (!['first_touch', 'nurture', 'soft_followup'].includes(mode)) {
    throw new Error('--mode must be "first_touch", "nurture", or "soft_followup"');
  }

  const modeLabels = {
    first_touch: 'FIRST TOUCH (A/B)',
    nurture: 'NURTURE (Campaign C)',
    soft_followup: 'SOFT FOLLOW-UP (Campaign D)',
  };
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PREPARE BATCH — ${modeLabels[mode]}`);
  console.log('═══════════════════════════════════════════════════════════');

  initDb();

  let candidates;
  let suppressedCount = 0;

  if (mode === 'nurture') {
    candidates = await prepareNurtureBatch(region, log);
  } else if (mode === 'soft_followup') {
    candidates = await prepareSoftFollowupBatch(region, log);
  } else {
    const result = await prepareFirstTouchBatch(region, minScore, tierFilter, testName, log);
    candidates = result.candidates;
    suppressedCount = result.suppressedCount;
  }

  // Sort by ICP score descending
  candidates.sort((a, b) => toInt(b.icpScore) - toInt(a.icpScore));

  // Apply limit
  if (limit > 0 && candidates.length > limit) {
    candidates = candidates.slice(0, limit);
    log.info('Batch limited', { limit, count: candidates.length });
  }

  if (candidates.length === 0) {
    console.log('\n  No contacts eligible for this batch. Exiting.');
    return { csvPath: null, metrics: { candidates: 0, suppressed: suppressedCount, queued: 0 } };
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
    for (const p of candidates) {
      p._abVariant = 'C';
    }
  } else if (mode === 'soft_followup') {
    for (const p of candidates) {
      p._abVariant = 'D';
    }
  } else {
    const salt = new Date().toISOString().slice(0, 10);
    for (const p of candidates) {
      const email = p.emails?.primaryEmail || '';
      const variant = assignAbVariant(email, new Date(`${salt}T00:00:00.000Z`));
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
    company_name: p.companyName || p.company?.name || '',
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
    assignedInbox: p.assignedInbox || '',
    mode,
    testName: testName || '',
    twentyId: p.id,
  }));

  // Write CSV
  const date = new Date().toISOString().slice(0, 10);
  const regionSlug = region ? region.toLowerCase().replace(/\s+/g, '_') : 'all_regions';
  const modeSlugs = { first_touch: 'batch', nurture: 'nurture', soft_followup: 'followup' };
  const modeSlug = modeSlugs[mode] || 'batch';
  const testSlug = testName ? `_${testName.replace(/\s+/g, '_')}` : '';
  const outputDir = join(__dirname, 'output');
  mkdirSync(outputDir, { recursive: true });
  const csvPath = join(outputDir, `${modeSlug}_${regionSlug}${testSlug}_${date}.csv`);
  writeFileSync(csvPath, stringify(csvRows, { header: true }));

  // Update SQLite
  if (!dryRun) {
    const targetStages = { first_touch: 'queued', nurture: 'nurture', soft_followup: 'queued' };
    const targetStage = targetStages[mode] || 'queued';
    log.info('Updating SQLite', { targetStage, count: candidates.length });
    const updates = candidates.map((p) => {
      const update = {
        id: p.id,
        funnel_stage: targetStage,
        ab_variant: p._abVariant,
      };
      if (testName) {
        update.ab_test_name = testName;
        const existing = (p.abTestHistory || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!existing.includes(testName)) existing.push(testName);
        update.ab_test_history = existing.join(',');
      }
      return update;
    });
    updateLeads(updates);
    log.info('SQLite updated', { updated: updates.length, errors: 0 });
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
    console.log('  DRY RUN — SQLite not updated');
  } else {
    const summaryStages = { first_touch: 'queued', nurture: 'nurture', soft_followup: 'queued' };
    console.log(`  SQLite updated: ${candidates.length} leads -> funnelStage: '${summaryStages[mode] || 'queued'}'`);
  }
  console.log(`  CSV written to: ${csvPath}`);

  const metrics = {
    candidates: candidates.length + suppressedCount,
    suppressed: suppressedCount,
    queued: candidates.length,
    variantA,
    variantB,
    tierBreakdown,
  };
  log.info('Batch prepared', metrics);

  return { csvPath, metrics };
}

// Only run when called directly from CLI
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
