#!/usr/bin/env node

/**
 * Select from Pool — Pick the best unenriched leads for this week's batch
 *
 * Reads all CSVs in leads/pool/, deduplicates against Twenty CRM (skips anyone
 * already imported), sorts by ICP score descending (Hot → High → Medium → Low),
 * and outputs a batch CSV ready for Apify enrichment.
 *
 * Strategy: exhaust Hot tier across all regions before touching High, exhaust
 * High before touching Medium. Every weekly batch is the best available leads
 * you haven't already put into the CRM.
 *
 * Usage:
 *   node scripts/select-from-pool.js --limit 500 [--region "SF Bay"] [--min-score 55] [--dry-run]
 *
 * Weekly cycle:
 *   1. select-from-pool.js --limit 500 --min-score 55
 *   2. Run Apify enrichment on the output
 *   3. bulk-import-twenty.js enriched_batch.csv
 *   4. prepare-batch.js --test "subject_v1"
 *   5. push-to-instantly.js batch.csv
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  hasTwentyConfig,
  loadEmailIdMap,
  toInt,
} from './lib/twenty-client.js';
import { extractRegion, icpTier } from './lib/constants.js';
import { createLogger } from './lib/logger.js';

const log = createLogger({ step: 'select' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const POOL_DIR = process.env.LEAD_POOL_DIR || join(__dirname, '../leads/pool');

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

const limit = toInt(getArg('--limit'), 500);
const regionFilter = getArg('--region');
const minScore = toInt(getArg('--min-score'), 0);
const dryRun = hasFlag('--dry-run');

// ---------------------------------------------------------------------------
// Load pool CSVs
// ---------------------------------------------------------------------------

function loadPool() {
  let files;
  try {
    files = readdirSync(POOL_DIR).filter((f) => f.endsWith('.csv')).sort();
  } catch {
    console.error(`Error: leads/pool/ directory not found at ${POOL_DIR}`);
    console.error('Create it and drop your Clay CSVs there.');
    process.exit(1);
  }

  if (files.length === 0) {
    console.error('Error: No CSV files found in leads/pool/');
    console.error('Drop your Clay export CSVs into leads/pool/ and re-run.');
    process.exit(1);
  }

  console.log(`  Found ${files.length} CSV file(s) in pool:`);
  const allLeads = [];
  const seenEmails = new Set();

  for (const file of files) {
    const filePath = join(POOL_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

    let added = 0;
    let dupes = 0;
    for (const row of rows) {
      const email = (row['Work Email'] || row.Email || row.email || '').toLowerCase().trim();
      if (!email) continue;
      if (seenEmails.has(email)) {
        dupes++;
        continue;
      }
      seenEmails.add(email);

      // Normalize key fields
      row._email = email;
      row._firstName = row['First Name'] || row.first_name || '';
      row._lastName = row['Last Name'] || row.last_name || '';
      row._company = row['Company Name'] || row.company_name || row.company || '';
      row._location = row.Location || row.location || row.City || row.city || '';
      row._region = row.region || extractRegion(row._location);
      row._linkedinUrl = row['LinkedIn Profile'] || row.linkedin_url || '';
      // IG handle may be a full URL — extract just the username
      // Clay CSVs use various column names; 'Instagram Profile URL' often has garbage like "Response"
      // so prioritize 'Instagram URL' (real URLs) and 'IG handle' (clean handles)
      const igGarbage = /^(response|n\/a|none|error|null|undefined|true|false)$/i;
      const igCandidates = [
        row['IG handle'], row['Instagram URL'], row['Instagram Profile URL'], row.ig_username
      ].filter(v => v && !igGarbage.test(v.trim()));
      const rawIg = igCandidates.find(v => /instagram\.com\//.test(v) || /^@?\w[\w.]{0,28}\w$/.test(v)) || '';
      row._igHandle = rawIg.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[/?#].*$/, '').replace(/^@/, '') || '';
      row._jobTitle = row.job_title || row['Job Title'] || '';

      // Use Clay-provided ICP score if available, otherwise 0 (will be scored during enrichment)
      // "ICP Post-Instagram" is the final score after all Clay enrichment passes
      row._icpScore = toInt(row['ICP Post-Instagram'] || row['ICP Post Work Email'] || row['ICP Post-LinkedIn'] || row.icp_score || row['ICP Score']);
      row._icpTier = row.icp_tier || row['ICP Tier'] || (row._icpScore > 0 ? icpTier(row._icpScore) : '');

      row._sourceFile = file;
      allLeads.push(row);
      added++;
    }

    console.log(`    ${file}: ${added} leads loaded${dupes > 0 ? `, ${dupes} intra-pool dupes skipped` : ''}`);
  }

  log.info('Pool loaded', { totalUnique: allLeads.length, files: files.length });
  return allLeads;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SELECT FROM POOL — Pick leads for enrichment');
  console.log('═══════════════════════════════════════════════════════════');

  // Load all pool CSVs
  const allLeads = loadPool();

  // Deduplicate against Twenty CRM
  let crmEmails = new Set();
  if (hasTwentyConfig()) {
    console.log('\n  Loading existing contacts from Twenty CRM for dedup...');
    const emailMap = await loadEmailIdMap();
    crmEmails = new Set(emailMap.keys());
    console.log(`  CRM contains ${crmEmails.size} contacts`);
  } else {
    console.log('\n  Warning: Twenty CRM not configured — skipping dedup');
  }

  let crmDupCount = 0;
  let candidates = allLeads.filter((lead) => {
    if (crmEmails.has(lead._email)) {
      crmDupCount++;
      return false;
    }
    return true;
  });
  log.info('CRM dedup complete', { crmDups: crmDupCount, available: candidates.length });

  // Apply region filter
  if (regionFilter) {
    candidates = candidates.filter((lead) => lead._region === regionFilter);
    console.log(`  After region filter ("${regionFilter}"): ${candidates.length}`);
  }

  // Apply min score filter (only if leads have scores from Clay)
  if (minScore > 0) {
    const withScores = candidates.filter((lead) => lead._icpScore >= minScore);
    const noScores = candidates.filter((lead) => lead._icpScore === 0);
    // Include leads without scores (they'll be scored during enrichment)
    // but sort them below leads with scores
    candidates = [...withScores, ...noScores];
    console.log(`  Score filter (>= ${minScore}): ${withScores.length} scored + ${noScores.length} unscored`);
  }

  // Sort: Hot first → High → Medium → Low → unscored
  // Within same tier, sort by ICP score descending
  const tierOrder = { hot: 0, high: 1, medium: 2, low: 3, '': 4 };
  candidates.sort((a, b) => {
    const tierA = tierOrder[a._icpTier.toLowerCase()] ?? 4;
    const tierB = tierOrder[b._icpTier.toLowerCase()] ?? 4;
    if (tierA !== tierB) return tierA - tierB;
    return b._icpScore - a._icpScore;
  });

  // Company spacing — only 1 lead per company per batch. Same-company leads
  // are deferred to the back of the list so they land in future batches, not skipped.
  const seenCompanies = new Set();
  const thisBatch = [];
  const deferred = [];
  for (const lead of candidates) {
    const company = (lead._company || '').toLowerCase().trim();
    if (!company || !seenCompanies.has(company)) {
      thisBatch.push(lead);
      if (company) seenCompanies.add(company);
    } else {
      deferred.push(lead);
    }
  }
  if (deferred.length > 0) {
    console.log(`  Company spacing: ${deferred.length} same-company leads deferred to future batches`);
  }
  candidates = [...thisBatch, ...deferred];

  // Apply limit
  const selected = candidates.slice(0, limit);
  console.log(`\n  Selected: ${selected.length} (limit: ${limit})`);

  if (selected.length === 0) {
    console.log('\n  No leads available for selection. Exiting.');
    return;
  }

  // Breakdown by tier
  const tierBreakdown = {};
  for (const lead of selected) {
    const tier = lead._icpTier || 'unscored';
    tierBreakdown[tier] = (tierBreakdown[tier] || 0) + 1;
  }

  // Breakdown by region
  const regionBreakdown = {};
  for (const lead of selected) {
    const r = lead._region || 'unknown';
    regionBreakdown[r] = (regionBreakdown[r] || 0) + 1;
  }

  // Breakdown by source file
  const sourceBreakdown = {};
  for (const lead of selected) {
    sourceBreakdown[lead._sourceFile] = (sourceBreakdown[lead._sourceFile] || 0) + 1;
  }

  // Print summary
  console.log('\n  TIER BREAKDOWN:');
  console.log('  ┌──────────────┬───────┐');
  console.log('  │ Tier         │ Count │');
  console.log('  ├──────────────┼───────┤');
  for (const [tier, count] of Object.entries(tierBreakdown).sort((a, b) => {
    return (tierOrder[a[0].toLowerCase()] ?? 4) - (tierOrder[b[0].toLowerCase()] ?? 4);
  })) {
    console.log(`  │ ${tier.padEnd(12)} │ ${String(count).padStart(5)} │`);
  }
  console.log('  └──────────────┴───────┘');

  console.log('\n  REGION BREAKDOWN:');
  console.log('  ┌──────────────┬───────┐');
  console.log('  │ Region       │ Count │');
  console.log('  ├──────────────┼───────┤');
  for (const [r, count] of Object.entries(regionBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  │ ${r.padEnd(12)} │ ${String(count).padStart(5)} │`);
  }
  console.log('  └──────────────┴───────┘');

  console.log('\n  SOURCE FILES:');
  for (const [file, count] of Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${file}: ${count} leads`);
  }

  // Show remaining pool after this selection
  const remaining = candidates.length - selected.length;
  const remainingByTier = {};
  for (const lead of candidates.slice(selected.length)) {
    const tier = lead._icpTier || 'unscored';
    remainingByTier[tier] = (remainingByTier[tier] || 0) + 1;
  }
  console.log(`\n  Remaining in pool after this batch: ${remaining}`);
  if (remaining > 0) {
    for (const [tier, count] of Object.entries(remainingByTier).sort((a, b) => {
      return (tierOrder[a[0].toLowerCase()] ?? 4) - (tierOrder[b[0].toLowerCase()] ?? 4);
    })) {
      console.log(`    ${tier}: ${count}`);
    }
  }

  if (dryRun) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  DRY RUN — No files written');
    console.log('═══════════════════════════════════════════════════════════');
    return;
  }

  // Write output CSV — pass through all original columns + normalized fields
  const csvRows = selected.map((lead) => ({
    'First Name': lead._firstName,
    'Last Name': lead._lastName,
    Email: lead._email,
    'Work Email': lead._email,
    'Company Name': lead._company,
    'Job Title': lead._jobTitle,
    'LinkedIn Profile': lead._linkedinUrl,
    'IG handle': lead._igHandle,
    Location: lead._location,
    region: lead._region,
    icp_score: lead._icpScore || '',
    icp_tier: lead._icpTier || '',
    source_file: lead._sourceFile,
  }));

  const date = new Date().toISOString().slice(0, 10);
  const outputDir = join(__dirname, 'output');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `to_enrich_${date}.csv`);
  writeFileSync(outputPath, stringify(csvRows, { header: true }));

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  SELECTION COMPLETE — ${selected.length} leads`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Output: ${outputPath}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Run Apify enrichment on ${outputPath}`);
  console.log('    2. npm run import -- enriched_output.csv');
  console.log('    3. npm run batch:prepare -- --region "SF Bay" --test "subject_v1"');
  console.log('    4. npm run batch:push -- batch.csv');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
