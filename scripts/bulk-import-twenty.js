#!/usr/bin/env node

/**
 * Bulk Import to Twenty CRM
 *
 * Batch imports contacts from a Clay CSV into Twenty CRM with company creation,
 * deduplication, and full field mapping.
 *
 * Usage:
 *   node scripts/bulk-import-twenty.js <csv> [--region "SF Bay"] [--limit 100] [--dry-run]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'csv-parse/sync';
import {
  toInt,
} from './lib/twenty-client.js';
import { extractRegion, icpTier } from './lib/constants.js';
import { createLogger } from './lib/logger.js';
import { csvRowToLead } from './lib/lead-mappers.js';
import { findLeadByEmail, initDb, insertLeads, upsertCompany } from './lib/db.js';

const log = createLogger({ step: 'import' });

// ---------------------------------------------------------------------------
// CLI arg parsing
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
const regionOverride = getArg('--region');
const limit = toInt(getArg('--limit'), 0);
const dryRun = hasFlag('--dry-run');

if (!csvPath) {
  console.error('Usage: node scripts/bulk-import-twenty.js <csv> [--region "SF Bay"] [--limit 100] [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BULK IMPORT TO SQLITE');
  console.log('═══════════════════════════════════════════════════════════');

  initDb();

  // Parse CSV
  const fullPath = resolve(csvPath);
  console.log(`\nReading: ${fullPath}`);
  const csvContent = readFileSync(fullPath, 'utf-8');
  let rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  log.info('CSV parsed', { rows: rows.length, path: fullPath });

  // Validate required columns
  const columns = Object.keys(rows[0] || {});
  const required = ['First Name', 'Last Name'];
  const emailCol = columns.includes('Work Email') ? 'Work Email' : columns.includes('Email') ? 'Email' : null;
  if (!emailCol) {
    console.error('Error: CSV must have a "Work Email" or "Email" column');
    process.exit(1);
  }
  const missing = required.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    console.error(`Error: Missing required columns: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Apply limit
  if (limit > 0) {
    rows = rows.slice(0, limit);
    console.log(`  Limited to ${rows.length} rows`);
  }

  // Apply region override or extract from location
  for (const row of rows) {
    if (regionOverride) {
      row.region = regionOverride;
    } else if (!row.region) {
      row.region = extractRegion(row.Location || row.location || row.City || '');
    }
    // Ensure icp_tier is set
    if (!row.icp_tier && row.icp_score) {
      row.icp_tier = icpTier(toInt(row.icp_score));
    }
  }

  if (dryRun) {
    printDryRunSummary(rows, emailCol);
    return;
  }

  // Extract unique companies and upsert
  const uniqueCompanies = new Set();
  for (const row of rows) {
    const name = row['Company Name'] || '';
    if (name) uniqueCompanies.add(name);
  }
  console.log(`\n  Upserting ${uniqueCompanies.size} unique companies into SQLite...`);
  let companiesCreated = 0;
  const companyMap = new Map();
  for (const name of uniqueCompanies) {
    const companyId = upsertCompany(name, '');
    companyMap.set(name.toLowerCase(), companyId);
    if (companyId) companiesCreated++;
  }
  console.log(`  Companies created: ${companiesCreated}`);

  // Upsert into SQLite
  const upserts = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const email = (row[emailCol] || '').toLowerCase();
    if (!email || !email.includes('@')) {
      skipped++;
      continue;
    }

    const companyName = row['Company Name'] || '';
    const companyId = companyName ? companyMap.get(companyName.toLowerCase()) || null : null;

    // Set funnel stage
    if (!row.funnel_stage && !row.funnelStage) {
      row.funnel_stage = row.icp_score ? 'scored' : 'new';
    }

    const existing = findLeadByEmail(email);
    if (existing) updated++;
    else created++;
    upserts.push(csvRowToLead(row, {
      id: existing?.id,
      companyId,
      region: row.region,
    }));
  }

  console.log(`\n  To create: ${created}`);
  console.log(`  To update: ${updated}`);
  console.log(`  Skipped (no email): ${skipped}`);
  insertLeads(upserts);
  const createResult = { created, errors: 0, errorDetails: [] };
  const updateResult = { updated, errors: 0, errorDetails: [] };
  log.info('SQLite leads upserted', { created, updated });

  // Print summary
  printSummary(rows, emailCol, createResult, updateResult, skipped, companiesCreated);

}

function printDryRunSummary(rows, emailCol) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DRY RUN — No records will be created or updated');
  console.log('═══════════════════════════════════════════════════════════');

  const withEmail = rows.filter((r) => {
    const email = r[emailCol] || '';
    return email && email.includes('@');
  });
  const byRegion = {};
  const byTier = {};
  for (const row of rows) {
    const region = row.region || '(none)';
    byRegion[region] = (byRegion[region] || 0) + 1;
    const tier = row.icp_tier || '(none)';
    byTier[tier] = (byTier[tier] || 0) + 1;
  }

  console.log(`  Total rows: ${rows.length}`);
  console.log(`  With valid email: ${withEmail.length}`);
  console.log(`  Without email: ${rows.length - withEmail.length}`);
  console.log('\n  By Region:');
  for (const [region, count] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${region}: ${count}`);
  }
  console.log('\n  By ICP Tier:');
  for (const [tier, count] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tier}: ${count}`);
  }

  printFieldCoverage(rows, emailCol);
}

function printSummary(rows, emailCol, createResult, updateResult, skipped, companiesCreated) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  IMPORT RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Created:  ${createResult.created} new People`);
  console.log(`  Updated:  ${updateResult.updated} existing People`);
  console.log(`  Skipped:  ${skipped} (no email)`);
  console.log(`  Errors:   ${createResult.errors + updateResult.errors}`);
  console.log(`\n  Companies created: ${companiesCreated}`);

  printFieldCoverage(rows, emailCol);
}

function printFieldCoverage(rows, emailCol) {
  const fields = [
    { label: 'email', key: emailCol },
    { label: 'firstName', key: 'First Name' },
    { label: 'lastName', key: 'Last Name' },
    { label: 'icpScore', key: 'icp_score' },
    { label: 'icpTier', key: 'icp_tier' },
    { label: 'linkedinHeadline', key: 'linkedin_headline' },
    { label: 'igUsername', key: 'ig_username', alt: 'IG handle' },
    { label: 'igFollowers', key: 'ig_followers' },
    { label: 'region', key: 'region' },
    { label: 'funnelStage', key: 'funnel_stage', alt: 'funnelStage' },
    { label: 'igRecentAddrs', key: 'ig_recent_addresses', alt: 'igRecentAddresses' },
    { label: 'igNeighborhoods', key: 'ig_neighborhoods', alt: 'igNeighborhoods' },
    { label: 'igListingPosts', key: 'ig_listing_posts', alt: 'igListingPostsCount' },
    { label: 'igSoldPosts', key: 'ig_sold_posts', alt: 'igSoldPostsCount' },
    { label: 'companyName', key: 'Company Name' },
  ];

  console.log('\n  FIELD COVERAGE:');
  console.log('  ┌────────────────────────┬────────┬───────┐');
  console.log('  │ Field                  │ Filled │ Empty │');
  console.log('  ├────────────────────────┼────────┼───────┤');
  for (const f of fields) {
    const filled = rows.filter((r) => {
      const val = r[f.key] || (f.alt ? r[f.alt] : '');
      return val && String(val).trim() !== '';
    }).length;
    const empty = rows.length - filled;
    const label = f.label.padEnd(22);
    console.log(`  │ ${label} │ ${String(filled).padStart(6)} │ ${String(empty).padStart(5)} │`);
  }
  console.log('  └────────────────────────┴────────┴───────┘');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
