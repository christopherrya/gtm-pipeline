#!/usr/bin/env node

/**
 * Personalize Batch — LLM-powered email personalization for Hot/High ICP leads
 *
 * Reads a batch CSV (from prepare-batch.js), assigns A/B/C patterns, runs Claude
 * personalization for eligible leads, and writes a new CSV with personalized output.
 *
 * Pattern rotation: A (The Moment), B (The Peer Observation), C (The Specific Question)
 * Conflict resolution: same brokerage or same LinkedIn topic can't share a pattern.
 *
 * Usage:
 *   node scripts/personalize-batch.js <csv>                          # Full run
 *   node scripts/personalize-batch.js <csv> --dry-run                # Eligibility + patterns + cost estimate
 *   node scripts/personalize-batch.js <csv> --test                   # Process only first 5 eligible leads
 *   node scripts/personalize-batch.js <csv> --max-cost 15.00         # Custom budget cap
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { assessEligibility, eligibilityReport } from './lib/content-filter.js';
import { personalizeBatch, estimateCost } from './lib/llm-client.js';
import { getFallback } from './lib/prompt-templates.js';

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
const dryRun = hasFlag('--dry-run');
const testMode = hasFlag('--test');
const maxCost = parseFloat(getArg('--max-cost') || '10.00');

if (!csvPath) {
  console.error('Usage: node scripts/personalize-batch.js <csv> [--dry-run] [--test] [--max-cost 10.00]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PERSONALIZE BATCH — LLM Email Personalization');
  console.log('═══════════════════════════════════════════════════════════');

  const fullPath = resolve(csvPath);
  console.log(`\n  Reading: ${fullPath}`);
  const csvContent = readFileSync(fullPath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`  Loaded ${rows.length} leads`);

  // Eligibility assessment + pattern assignment
  console.log('\n  Assessing eligibility + assigning patterns...');
  const report = eligibilityReport(rows);

  console.log(`\n  ELIGIBILITY BREAKDOWN:`);
  console.log(`  ┌────────────────────────┬───────┐`);
  console.log(`  │ Category               │ Count │`);
  console.log(`  ├────────────────────────┼───────┤`);
  console.log(`  │ LLM eligible           │ ${String(report.counts.llm_eligible).padStart(5)} │`);
  console.log(`  │ Low tier (rule-based)  │ ${String(report.counts.low_tier).padStart(5)} │`);
  console.log(`  │ Stale data             │ ${String(report.counts.stale_data).padStart(5)} │`);
  console.log(`  │ Irrelevant data        │ ${String(report.counts.irrelevant_data).padStart(5)} │`);
  console.log(`  │ No enrichment          │ ${String(report.counts.no_enrichment).padStart(5)} │`);
  console.log(`  ├────────────────────────┼───────┤`);
  console.log(`  │ Total                  │ ${String(report.total).padStart(5)} │`);
  console.log(`  └────────────────────────┴───────┘`);

  // Show pattern distribution
  const patternCounts = { A: 0, B: 0, C: 0 };
  for (const entry of report.eligible) {
    patternCounts[entry.pattern] = (patternCounts[entry.pattern] || 0) + 1;
  }
  console.log(`\n  PATTERN ASSIGNMENT:`);
  console.log(`    A (The Moment):           ${patternCounts.A}`);
  console.log(`    B (The Peer Observation): ${patternCounts.B}`);
  console.log(`    C (The Specific Question):${patternCounts.C}`);

  let eligibleLeads = report.eligible;
  if (testMode) {
    eligibleLeads = eligibleLeads.slice(0, 5);
    console.log(`\n  TEST MODE — processing only first ${eligibleLeads.length} eligible leads`);
  }

  const estimate = estimateCost(eligibleLeads.length);
  console.log(`\n  COST ESTIMATE:`);
  console.log(`    Model: ${estimate.model}`);
  console.log(`    Eligible leads: ${estimate.eligibleCount}`);
  console.log(`    Est. input tokens: ${estimate.estimatedInputTokens.toLocaleString()}`);
  console.log(`    Est. output tokens: ${estimate.estimatedOutputTokens.toLocaleString()}`);
  console.log(`    Est. cost: ${estimate.estimatedCostFormatted}`);
  console.log(`    Budget cap: $${maxCost.toFixed(2)}`);

  if (dryRun) {
    console.log('\n  DRY RUN — Pattern assignments:');
    for (const { lead, pattern } of eligibleLeads) {
      console.log(`    ${lead.first_name} ${lead.last_name} (${lead.icp_tier}, ${lead.company_name}) → Pattern ${pattern}`);
    }
    console.log('\n  DRY RUN — No API calls made. Remove --dry-run to execute.');
    return;
  }

  if (eligibleLeads.length === 0) {
    console.log('\n  No leads eligible for LLM personalization. Applying fallbacks...');
    applyAllFallbacks(rows);
    writeOutput(rows, fullPath);
    return;
  }

  // Run LLM personalization
  console.log(`\n  Running LLM personalization (max concurrent: 10)...`);
  const { results, cost } = await personalizeBatch(eligibleLeads, maxCost, (processed, total, costSoFar) => {
    process.stdout.write(`\r  Progress: ${processed}/${total} leads | Cost: ${costSoFar.costFormatted}    `);
  });
  console.log('');

  // Build result map by email
  const methodCounts = { llm: 0, fallback_validation: 0, fallback_error: 0, fallback_budget: 0 };
  const llmResultMap = new Map();

  for (const { lead, result } of results) {
    if (!lead) continue;
    methodCounts[result.method] = (methodCounts[result.method] || 0) + 1;
    llmResultMap.set(lead.email, result);
  }

  // Build pattern map from eligibility results
  const patternMap = new Map();
  for (const entry of report.eligible) {
    patternMap.set(entry.lead.email, entry.pattern);
  }

  // Apply results to all rows
  for (const row of rows) {
    const llmResult = llmResultMap.get(row.email);
    const pattern = patternMap.get(row.email) || 'B';

    if (llmResult && llmResult.success) {
      // LLM succeeded
      row.personalized_subject = llmResult.subject;
      row.personalized_hook = llmResult.hook;
      row.personalization_method = 'llm';
      row.personalization_pattern = llmResult.pattern;
      row.discloser_capability = llmResult.discloser_capability_used;
      row.hook_word_count = llmResult.word_count;
    } else if (llmResult) {
      // LLM failed — use pattern-specific fallback
      const fb = getFallback(pattern, row);
      row.personalized_subject = fb.subject;
      row.personalized_hook = fb.hook;
      row.personalization_method = llmResult.method;
      row.personalization_pattern = fb.pattern;
      row.discloser_capability = fb.discloser_capability_used;
      row.hook_word_count = fb.hook.split(/\s+/).filter(Boolean).length;
    } else {
      // Not eligible — pattern fallback or generic
      const assessment = assessEligibility(row);
      const fb = getFallback(pattern, row);
      row.personalized_subject = fb.subject;
      row.personalized_hook = fb.hook;
      row.personalization_method = assessment.reason === 'low_tier' ? 'rule_based' : `rule_based_${assessment.reason}`;
      row.personalization_pattern = fb.pattern;
      row.discloser_capability = fb.discloser_capability_used;
      row.hook_word_count = fb.hook.split(/\s+/).filter(Boolean).length;
    }
    row.llm_model = row.personalization_method === 'llm' ? 'claude-sonnet-4' : '';
  }

  writeOutput(rows, fullPath);

  // Print comparison cards
  console.log('\n  RESULTS BY LEAD:');
  for (const row of rows) {
    const methodTag = row.personalization_method === 'llm' ? 'LLM' : row.personalization_method.toUpperCase();
    console.log(`\n  ── ${row.first_name} ${row.last_name} (${row.icp_tier}) — Pattern ${row.personalization_pattern} [${methodTag}] ──`);
    console.log(`    Subject: ${row.personalized_subject}`);
    console.log(`    Hook: ${row.personalized_hook}`);
    if (row.discloser_capability) console.log(`    Capability: ${row.discloser_capability}`);
    console.log(`    Words: ${row.hook_word_count}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PERSONALIZATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  LLM personalized:    ${methodCounts.llm}`);
  console.log(`  Validation fallback: ${methodCounts.fallback_validation}`);
  console.log(`  Error fallback:      ${methodCounts.fallback_error}`);
  console.log(`  Budget fallback:     ${methodCounts.fallback_budget}`);
  console.log(`  Rule-based:          ${rows.length - Object.values(methodCounts).reduce((a, b) => a + b, 0)}`);
  console.log(`\n  COST:`);
  console.log(`    API calls: ${cost.calls}`);
  console.log(`    Input tokens: ${cost.inputTokens.toLocaleString()}`);
  console.log(`    Output tokens: ${cost.outputTokens.toLocaleString()}`);
  console.log(`    Total cost: ${cost.costFormatted}`);
  console.log(`    Budget cap: $${maxCost.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// Apply fallbacks to all rows (when no LLM eligible)
// ---------------------------------------------------------------------------

function applyAllFallbacks(rows) {
  const patterns = ['A', 'B', 'C'];
  rows.forEach((row, i) => {
    const pattern = patterns[i % patterns.length];
    const fb = getFallback(pattern, row);
    row.personalized_subject = fb.subject;
    row.personalized_hook = fb.hook;
    row.personalization_method = 'rule_based';
    row.personalization_pattern = fb.pattern;
    row.discloser_capability = fb.discloser_capability_used;
    row.hook_word_count = fb.hook.split(/\s+/).filter(Boolean).length;
    row.llm_model = '';
  });
}

// ---------------------------------------------------------------------------
// Write output CSV
// ---------------------------------------------------------------------------

function writeOutput(rows, inputPath) {
  const dir = dirname(inputPath);
  const ext = extname(inputPath);
  const base = basename(inputPath, ext);
  const outputPath = resolve(dir, `${base}_personalized${ext}`);

  writeFileSync(outputPath, stringify(rows, { header: true }));
  console.log(`\n  Output: ${outputPath}`);
  console.log(`  Rows: ${rows.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
