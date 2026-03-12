#!/usr/bin/env node

/**
 * Reset stuck queued leads back to scored.
 *
 * During the pipeline run on 2026-03-10, prepare-batch marked ~1,054 hot/high/medium
 * leads as funnelStage=queued but the push step never ran for them. They have no
 * instantlyCampaignId set, so we can safely identify them.
 *
 * The weekly pipeline only queries funnelStage=scored, so without this fix those leads
 * would be permanently skipped — including all our strongest ICP profiles.
 *
 * Safe by design:
 *   - Only resets leads where instantlyCampaignId is empty (never actually pushed)
 *   - Leads already in Instantly (instantlyCampaignId set) are left untouched
 *   - --dry-run shows exactly what will change before committing
 *
 * Usage:
 *   node scripts/reset-queued-leads.js --dry-run   # Preview, no changes
 *   node scripts/reset-queued-leads.js             # Apply
 *   node scripts/reset-queued-leads.js --yes       # Apply without confirmation prompt
 */

import { paginateAll, batchUpdate, toInt } from './lib/twenty-client.js';
import { icpTier } from './lib/constants.js';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noPrompt = args.includes('--yes');

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RESET STUCK QUEUED LEADS → scored');
  console.log('═══════════════════════════════════════════════════════════');
  if (dryRun) console.log('  Mode: DRY RUN — no changes will be made');
  console.log('');

  // -------------------------------------------------------------------------
  // 1. Fetch all queued leads
  // -------------------------------------------------------------------------
  console.log('  Querying Twenty for funnelStage=queued contacts...');
  const allQueued = await paginateAll('people', { and: [{ funnelStage: { eq: 'queued' } }] });
  console.log(`  Total queued in CRM: ${allQueued.length}`);

  // -------------------------------------------------------------------------
  // 2. Split: stuck (no campaign ID) vs. legitimately in Instantly
  // -------------------------------------------------------------------------
  const stuck = allQueued.filter((p) => !p.instantlyCampaignId);
  const inInstantly = allQueued.filter((p) => !!p.instantlyCampaignId);

  console.log(`  Already in Instantly (keep as-is): ${inInstantly.length}`);
  console.log(`  Stuck — never pushed to Instantly: ${stuck.length}`);

  if (stuck.length === 0) {
    console.log('\n  Nothing to reset. All queued leads are already in Instantly.');
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Tier breakdown so we know what we're recovering
  // -------------------------------------------------------------------------
  const tierBreakdown = {};
  for (const p of stuck) {
    const tier = p.icpTier || icpTier(toInt(p.icpScore));
    tierBreakdown[tier] = (tierBreakdown[tier] || 0) + 1;
  }

  const tierOrder = ['Hot', 'High', 'Medium', 'Low', 'low', 'medium', 'high', 'hot'];
  const sortedTiers = Object.entries(tierBreakdown).sort((a, b) => {
    const ai = tierOrder.findIndex((t) => t.toLowerCase() === a[0].toLowerCase());
    const bi = tierOrder.findIndex((t) => t.toLowerCase() === b[0].toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  console.log('\n  ICP tier breakdown of stuck leads:');
  console.log('  ┌──────────┬───────┐');
  console.log('  │ Tier     │ Count │');
  console.log('  ├──────────┼───────┤');
  for (const [tier, count] of sortedTiers) {
    const t = (tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase()).padEnd(8);
    console.log(`  │ ${t}  │ ${String(count).padStart(5) } │`);
  }
  console.log('  └──────────┴───────┘');

  // Score distribution
  const scores = stuck.map((p) => toInt(p.icpScore)).filter((s) => s > 0).sort((a, b) => b - a);
  if (scores.length > 0) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    console.log(`\n  ICP score — min: ${scores[scores.length - 1]}  avg: ${avg}  max: ${scores[0]}`);
  }

  if (dryRun) {
    console.log('\n  DRY RUN complete. Run without --dry-run to apply the reset.');
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Confirm before writing
  // -------------------------------------------------------------------------
  if (!noPrompt) {
    console.log('');
    const answer = await prompt(`  Reset ${stuck.length} leads to scored? (yes/no): `);
    if (answer !== 'yes' && answer !== 'y') {
      console.log('\n  Aborted.');
      return;
    }
  }

  // -------------------------------------------------------------------------
  // 5. Batch reset funnelStage → scored
  // -------------------------------------------------------------------------
  console.log(`\n  Resetting ${stuck.length} leads to funnelStage=scored...`);
  const updates = stuck.map((p) => ({ id: p.id, funnelStage: 'scored' }));
  const result = await batchUpdate('people', updates);

  // -------------------------------------------------------------------------
  // 6. Summary
  // -------------------------------------------------------------------------
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Reset to scored:  ${result.updated}`);
  console.log(`  Errors:           ${result.errors}`);

  if (result.errors > 0 && result.errorDetails.length > 0) {
    console.log('\n  Error details (first 30):');
    for (const d of result.errorDetails) {
      console.log(`    ${d}`);
    }
  }

  if (result.updated > 0) {
    console.log('\n  Next steps:');
    console.log('    To send immediately (today):');
    console.log('      npm run batch:prepare && npm run batch:push');
    console.log('');
    console.log('    Or they will be picked up automatically on the next Monday 6am run.');
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
