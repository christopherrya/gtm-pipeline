#!/usr/bin/env node

/**
 * Cleanup Instantly leads with blank first names.
 *
 * Intended workflow:
 *   1. Export leads from Instantly (or use a lead CSV with email + first_name/firstName).
 *   2. Run this script in dry-run mode to inspect affected records.
 *   3. Re-run with --apply to delete those leads from Instantly.
 *   4. Re-push clean leads from the current pipeline.
 *
 * Usage:
 *   node scripts/cleanup-instantly-blank-first-names.js --csv ./instantly-export.csv
 *   node scripts/cleanup-instantly-blank-first-names.js --csv ./instantly-export.csv --apply
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'csv-parse/sync';
import { getEnv, withRetry } from './lib/twenty-client.js';

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const csvPath = getArg('--csv');
const apply = hasFlag('--apply');
const INSTANTLY_V1_BASE = 'https://api.instantly.ai/api/v1';

function getEmail(row) {
  return (row.email || row.Email || '').trim().toLowerCase();
}

function getFirstName(row) {
  return (
    row.first_name ||
    row.firstName ||
    row['First Name'] ||
    row.firstname ||
    ''
  ).trim();
}

function getCompany(row) {
  return row.company_name || row.company || row.Company || row['Company Name'] || '';
}

async function v1LeadDelete(emails) {
  const orgAuth = getEnv('INSTANTLY_ORG_AUTH');
  if (!orgAuth) throw new Error('INSTANTLY_ORG_AUTH not set in .env');

  const response = await fetch(`${INSTANTLY_V1_BASE}/lead/delete`, {
    method: 'POST',
    headers: {
      'x-org-auth': orgAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      delete_list: emails,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`v1/lead/delete failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function main() {
  if (!csvPath) {
    throw new Error('Usage: node scripts/cleanup-instantly-blank-first-names.js --csv <path> [--apply]');
  }

  const fullPath = resolve(csvPath);
  const content = readFileSync(fullPath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  const badRows = [];
  const seen = new Set();
  for (const row of rows) {
    const email = getEmail(row);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    if (getFirstName(row)) continue;
    badRows.push({
      email,
      company_name: getCompany(row),
    });
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CLEANUP INSTANTLY BLANK FIRST NAMES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n  Source CSV: ${fullPath}`);
  console.log(`  Rows scanned: ${rows.length}`);
  console.log(`  Leads with blank first name: ${badRows.length}`);

  for (const row of badRows.slice(0, 20)) {
    console.log(`    ${row.email}${row.company_name ? ` (${row.company_name})` : ''}`);
  }
  if (badRows.length > 20) {
    console.log(`    ...and ${badRows.length - 20} more`);
  }

  if (!apply) {
    console.log('\n  DRY RUN — no Instantly deletions made');
    console.log('  Re-run with --apply to delete these leads from Instantly before re-pushing.');
    return;
  }

  if (badRows.length === 0) {
    console.log('\n  Nothing to delete.');
    return;
  }

  const CHUNK_SIZE = 100;
  let deleted = 0;
  for (let i = 0; i < badRows.length; i += CHUNK_SIZE) {
    const chunk = badRows.slice(i, i + CHUNK_SIZE).map((row) => row.email);
    await withRetry(() => v1LeadDelete(chunk), 2, [3000, 10000]);
    deleted += chunk.length;
    console.log(`  Deleted chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} leads`);
  }

  console.log(`\n  Deleted from Instantly: ${deleted}`);
  console.log('  Next step: re-push the clean batch so Instantly gets the corrected greeting data.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
