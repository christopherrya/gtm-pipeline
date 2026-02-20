#!/usr/bin/env node

/**
 * Leads Merger
 *
 * Merges multiple enriched CSV files together using email as the key.
 * Useful when running LinkedIn and Instagram enrichers separately.
 *
 * Usage:
 *   npm run merge -- -i data/2enriched/linkedin.csv -i data/2enriched/instagram.csv -o merged.csv
 *   npm run merge -- --base data/1raw/leads.csv -i data/2enriched/linkedin.csv -i data/2enriched/instagram.csv
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Parse CLI arguments
const args = process.argv.slice(2);

function getAllArgs(flag) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const inputFiles = getAllArgs('-i').concat(getAllArgs('--input'));
const baseFile = getArg('--base');
const outputFile = getArg('-o') || getArg('--output');

if (inputFiles.length === 0) {
  console.error('Usage: npm run merge -- -i <file1.csv> -i <file2.csv> [-o <output.csv>]');
  console.error('       npm run merge -- --base <base.csv> -i <enriched.csv> [-o <output.csv>]');
  process.exit(1);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getEmail(row) {
  return (row.email || row.Email || row['Work Email'] || '').toLowerCase().trim();
}

function loadCSV(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found: ${absolutePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LEADS MERGER');
  console.log('═══════════════════════════════════════════════════════════════');

  // Load base file or first input file
  let mergedData;
  if (baseFile) {
    console.log(`\nBase file: ${baseFile}`);
    mergedData = loadCSV(baseFile);
    console.log(`  ${mergedData.length} records`);
  } else {
    console.log(`\nUsing first input as base: ${inputFiles[0]}`);
    mergedData = loadCSV(inputFiles.shift());
    console.log(`  ${mergedData.length} records`);
  }

  // Create lookup map by email
  const mergedMap = new Map();
  for (const row of mergedData) {
    const email = getEmail(row);
    if (email) {
      mergedMap.set(email, row);
    }
  }

  // Merge each input file
  for (const inputFile of inputFiles) {
    console.log(`\nMerging: ${inputFile}`);
    const data = loadCSV(inputFile);
    console.log(`  ${data.length} records`);

    let merged = 0;
    let added = 0;

    for (const row of data) {
      const email = getEmail(row);
      if (!email) continue;

      if (mergedMap.has(email)) {
        // Merge columns into existing row
        const existing = mergedMap.get(email);
        for (const [key, value] of Object.entries(row)) {
          // Don't overwrite existing non-empty values
          if (!existing[key] || existing[key] === '') {
            existing[key] = value;
          }
        }
        merged++;
      } else {
        // Add new row
        mergedMap.set(email, row);
        added++;
      }
    }

    console.log(`  Merged: ${merged}, Added: ${added}`);
  }

  // Convert back to array
  const outputData = Array.from(mergedMap.values());

  // Write output
  const outputPath = outputFile
    ? path.resolve(outputFile)
    : path.resolve('merged-leads.csv');

  const output = stringify(outputData, { header: true });
  fs.writeFileSync(outputPath, output);

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  MERGE COMPLETE`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Total Records: ${outputData.length}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
