#!/usr/bin/env node

/**
 * AI Hooks Generator
 *
 * Two modes:
 * 1. Extract: Pull hot lead contexts to JSON for Claude Code to review
 * 2. Apply: Apply AI-generated hooks back to CSV
 *
 * Usage:
 *   npm run hooks:extract -- --input data/3operational/{batch}/segment-hot.csv --output hot-hooks.json
 *   npm run hooks:apply -- --apply hot-hooks-completed.json --to data/3operational/{batch}/enriched-full.csv
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const inputFile = getArg('--input') || getArg('-i');
const outputFile = getArg('--output') || getArg('-o');
const applyFile = getArg('--apply');
const toFile = getArg('--to');

// ============================================================================
// EXTRACT MODE: Pull hot lead contexts for AI review
// ============================================================================

function extractLeadContext(lead) {
  return {
    id: lead.email || lead['Work Email'] || lead.Email,
    name: `${lead['First Name'] || ''} ${lead['Last Name'] || ''}`.trim(),
    company: lead['Company Name'] || lead.company || '',
    title: lead['Job Title'] || lead.job_title || '',

    // ICP data
    icp_score: parseInt(lead.icp_score) || 0,
    icp_tier: lead.icp_tier || '',
    transaction_urgency: lead.transaction_urgency || '',
    days_since_post: parseInt(lead.days_since_post) || null,

    // LinkedIn data
    linkedin_headline: lead.linkedin_headline || '',
    linkedin_posts_count: parseInt(lead.linkedin_posts_count) || 0,
    linkedin_recent_topic: lead.linkedin_recent_topic || '',

    // Instagram data
    ig_followers: parseInt(lead.ig_followers) || 0,
    ig_listing_posts_count: parseInt(lead.ig_listing_posts_count) || 0,
    ig_sold_posts_count: parseInt(lead.ig_sold_posts_count) || 0,
    ig_recent_addresses: lead.ig_recent_addresses || '',
    ig_recent_neighborhoods: lead.ig_recent_neighborhoods || '',

    // Current hook (for comparison)
    current_hook: lead.best_hook || '',
    current_hook_source: lead.hook_source || '',

    // Placeholder for AI-generated hook
    ai_hook: ''
  };
}

async function runExtract() {
  if (!inputFile) {
    console.error('Error: --input file required');
    console.error('Usage: node ai-hooks-generator.js --input segment-hot.csv --output hot-hooks.json');
    process.exit(1);
  }

  const inputPath = path.resolve(inputFile);

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\nExtracting lead contexts from: ${inputPath}`);

  const csvContent = fs.readFileSync(inputPath, 'utf-8');
  const leads = parse(csvContent, { columns: true, skip_empty_lines: true });

  console.log(`Found ${leads.length} leads`);

  // Extract contexts
  const contexts = leads.map(extractLeadContext);

  // Prepare output
  const output = {
    generated_at: new Date().toISOString(),
    source_file: inputFile,
    total_leads: contexts.length,
    instructions: `
AI Hook Guidelines:
- Be SPECIFIC - Reference actual addresses, achievements, or activity
- Be DIRECT - No passive "curious about" language
- Be INFORMATIVE - Surface a pain point or insight
- Be ACTION-ORIENTED - Imply the value prop (5 minutes vs 4 hours)

Examples:
- "$1B+ sold and counting. At that volume, every hour spent on disclosures is a listing you're not taking."
- "Probate and trust sales at 6077 Skyline come with extra disclosure complexity. That's exactly what we built Discloser for."
- "Top 10% TAN member listing in Cole Valley - your buyers expect the same precision in disclosures that you bring to marketing."

Fill in the "ai_hook" field for each lead below.
    `.trim(),
    leads: contexts
  };

  // Write output
  const outputPath = outputFile
    ? path.resolve(outputFile)
    : inputPath.replace('.csv', '-hooks.json');

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\nExtracted ${contexts.length} lead contexts to:`);
  console.log(`  ${outputPath}`);
  console.log('\nNext steps:');
  console.log('1. Open the JSON file and review each lead');
  console.log('2. Fill in the "ai_hook" field with a personalized hook');
  console.log('3. Save as hot-hooks-completed.json');
  console.log('4. Run: npm run hooks:apply -- --apply hot-hooks-completed.json --to enriched-full.csv');
}

// ============================================================================
// APPLY MODE: Apply AI-generated hooks back to CSV
// ============================================================================

async function runApply() {
  if (!applyFile || !toFile) {
    console.error('Error: Both --apply and --to files required');
    console.error('Usage: node ai-hooks-generator.js --apply hot-hooks-completed.json --to enriched-full.csv');
    process.exit(1);
  }

  const hooksPath = path.resolve(applyFile);
  const csvPath = path.resolve(toFile);

  if (!fs.existsSync(hooksPath)) {
    console.error(`Error: Hooks file not found: ${hooksPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`\nApplying AI hooks from: ${hooksPath}`);
  console.log(`To CSV: ${csvPath}`);

  // Load hooks
  const hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
  const hooksMap = new Map();

  let hooksWithContent = 0;
  for (const lead of hooksData.leads) {
    if (lead.ai_hook && lead.ai_hook.trim()) {
      hooksMap.set(lead.id.toLowerCase(), lead.ai_hook.trim());
      hooksWithContent++;
    }
  }

  console.log(`Found ${hooksWithContent} AI hooks to apply`);

  if (hooksWithContent === 0) {
    console.error('Error: No AI hooks found in the file. Did you fill in the ai_hook fields?');
    process.exit(1);
  }

  // Load CSV
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const leads = parse(csvContent, { columns: true, skip_empty_lines: true });

  // Apply hooks
  let applied = 0;
  for (const lead of leads) {
    const email = (lead.email || lead['Work Email'] || lead.Email || '').toLowerCase();
    if (hooksMap.has(email)) {
      lead.best_hook = hooksMap.get(email);
      lead.hook_source = 'AI-generated';
      applied++;
    }
  }

  console.log(`Applied ${applied} AI hooks to leads`);

  // Write output
  const outputPath = csvPath.replace('.csv', '-with-ai-hooks.csv');
  const output = stringify(leads, { header: true });
  fs.writeFileSync(outputPath, output);

  console.log(`\nSaved to: ${outputPath}`);

  // Also update original if requested
  if (args.includes('--overwrite')) {
    fs.writeFileSync(csvPath, output);
    console.log(`Overwrote original: ${csvPath}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AI HOOKS GENERATOR');
  console.log('═══════════════════════════════════════════════════════════════');

  if (applyFile) {
    await runApply();
  } else {
    await runExtract();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
