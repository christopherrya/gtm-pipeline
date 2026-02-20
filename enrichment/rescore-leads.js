#!/usr/bin/env node

/**
 * Rescore Leads
 *
 * Regenerates ICP scores and hooks from an already-enriched CSV file.
 * Does NOT call any external APIs - just recalculates from existing data.
 *
 * Usage:
 *   npm run rescore -- -i data/3operational/batch/enriched-full.csv
 *   npm run rescore -- -i data/3operational/batch/enriched-full.csv -o rescored.csv
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

const inputFile = getArg('-i') || getArg('--input');
const outputFile = getArg('-o') || getArg('--output');

if (!inputFile) {
  console.error('Usage: npm run rescore -- -i <input.csv> [-o <output.csv>]');
  process.exit(1);
}

// ============================================================================
// ICP SCORING (same logic as enrich-leads.js)
// ============================================================================

const SPECIALTY_KEYWORDS = ['luxury', 'team', 'lead', 'top', '#1', 'million', 'broker'];

function calculateIcpScore(lead) {
  let score = 50; // Clay baseline
  const breakdown = ['Clay baseline: 50'];

  // LinkedIn Activity (max +15)
  if (lead.linkedin_enriched === 'Yes') {
    score += 5;
    breakdown.push('LinkedIn enriched: +5');

    const postsCount = parseInt(lead.linkedin_posts_count) || 0;
    if (postsCount >= 3) {
      score += 5;
      breakdown.push(`LinkedIn ${postsCount} posts: +5`);
    }

    const headline = (lead.linkedin_headline || '').toLowerCase();
    const hasSpecialty = SPECIALTY_KEYWORDS.some(kw => headline.includes(kw));
    if (hasSpecialty) {
      score += 5;
      breakdown.push('LinkedIn specialty headline: +5');
    }
  }

  // Instagram Activity (max +15)
  if (lead.ig_enriched === 'Yes') {
    score += 5;
    breakdown.push('Instagram enriched: +5');

    const listingCount = parseInt(lead.ig_listing_posts_count) || 0;
    if (listingCount >= 2) {
      score += 5;
      breakdown.push(`Instagram ${listingCount} listing posts: +5`);
    }

    const followers = parseInt(lead.ig_followers) || 0;
    if (followers >= 1000) {
      score += 3;
      breakdown.push(`Instagram ${followers} followers: +3`);
    }

    const addresses = lead.ig_recent_addresses || '';
    if (addresses.trim()) {
      score += 2;
      breakdown.push('Instagram addresses found: +2');
    }
  }

  // Transaction Urgency (max +20)
  let urgencyScore = 0;
  const urgencyLevel = lead.transaction_urgency || '';

  if (urgencyLevel === 'High') {
    urgencyScore = 15;
    breakdown.push('Transaction urgency HIGH: +15');
  } else if (urgencyLevel === 'Medium') {
    urgencyScore = 10;
    breakdown.push('Transaction urgency MEDIUM: +10');
  } else if (urgencyLevel === 'Low') {
    urgencyScore = 5;
    breakdown.push('Transaction urgency LOW: +5');
  }

  // Multiple transactions bonus
  const listingCount = parseInt(lead.ig_listing_posts_count) || 0;
  const soldCount = parseInt(lead.ig_sold_posts_count) || 0;
  if (listingCount + soldCount >= 2 && urgencyScore < 20) {
    const multiBonus = Math.min(5, 20 - urgencyScore);
    urgencyScore += multiBonus;
    breakdown.push(`Multiple transactions: +${multiBonus}`);
  }

  score += Math.min(urgencyScore, 20);

  // Recency Bonus (-10 to +10)
  const daysSincePost = parseInt(lead.days_since_post);
  if (!isNaN(daysSincePost)) {
    let recencyBonus = 0;
    if (daysSincePost <= 3) recencyBonus = 10;
    else if (daysSincePost <= 7) recencyBonus = 7;
    else if (daysSincePost <= 14) recencyBonus = 5;
    else if (daysSincePost <= 30) recencyBonus = 2;
    else if (daysSincePost <= 90) recencyBonus = 0;
    else recencyBonus = -10;

    score += recencyBonus;
    if (recencyBonus !== 0) {
      breakdown.push(`Recency (${daysSincePost} days): ${recencyBonus > 0 ? '+' : ''}${recencyBonus}`);
    }
  }

  // Determine tier
  let tier = 'Low';
  if (score >= 90) tier = 'Hot';
  else if (score >= 70) tier = 'High';
  else if (score >= 55) tier = 'Medium';

  return {
    icp_score: Math.max(40, Math.min(110, score)),
    icp_tier: tier,
    icp_breakdown: breakdown.join(' | ')
  };
}

// ============================================================================
// HOOK GENERATION (same logic as enrich-leads.js)
// ============================================================================

function generateHook(lead) {
  const hooks = [];
  // Instagram address hook (base 8)
  const addresses = lead.ig_recent_addresses || '';
  if (addresses.trim()) {
    const firstAddress = addresses.split('|')[0].trim();
    hooks.push({
      base: 8,
      source: 'ig_address',
      hook: `${firstAddress} probably came with 150+ pages of disclosures. How long did your buyers spend actually reading them?`
    });
  }

  // Instagram neighborhood hook (base 7)
  const neighborhoods = lead.ig_recent_neighborhoods || lead.ig_neighborhoods || '';
  if (neighborhoods.trim()) {
    const firstHood = neighborhoods.split(',')[0].trim();
    hooks.push({
      base: 7,
      source: 'ig_neighborhood',
      hook: `In ${firstHood}, buyers expect perfection. One missed disclosure item can blow up a $2M deal.`
    });
  }

  // Instagram listing posts (base 6)
  const listingCount = parseInt(lead.ig_listing_posts_count) || 0;
  if (listingCount >= 2) {
    hooks.push({
      base: 6,
      source: 'ig_listings',
      hook: `${listingCount} listings means ${listingCount} sets of disclosures. Most agents spend 4+ hours each. We got it down to 5 minutes.`
    });
  }

  // LinkedIn listing/market posts (base 6)
  const linkedinTopic = (lead.linkedin_recent_topic || '').toLowerCase();
  if (linkedinTopic.includes('listing') || linkedinTopic.includes('market')) {
    hooks.push({
      base: 6,
      source: 'linkedin_listing',
      hook: `Saw your recent market post. In this market, bulletproof disclosures are your best defense. We make that easy.`
    });
  }

  // Instagram sold posts (base 5)
  const soldCount = parseInt(lead.ig_sold_posts_count) || 0;
  if (soldCount >= 1) {
    hooks.push({
      base: 5,
      source: 'ig_sold',
      hook: `${soldCount} recent close${soldCount > 1 ? 's' : ''} - congratulations. Your next listing's disclosures could be done in 5 minutes instead of 4 hours.`
    });
  }

  // LinkedIn market update (base 4)
  if (linkedinTopic.includes('update') || linkedinTopic.includes('analysis')) {
    hooks.push({
      base: 4,
      source: 'linkedin_market',
      hook: `Your market insights show you understand the details. That same precision in disclosures protects your deals.`
    });
  }

  // Instagram followers (base 3)
  const followers = parseInt(lead.ig_followers) || 0;
  if (followers >= 1000) {
    const followerK = (followers / 1000).toFixed(1).replace('.0', '');
    hooks.push({
      base: 3,
      source: 'ig_followers',
      hook: `${followerK}k followers means visibility. When deals close, your disclosures should be as polished as your marketing.`
    });
  }

  // LinkedIn headline specialty (base 2)
  const headline = (lead.linkedin_headline || '').toLowerCase();
  const specialties = ['luxury', 'team lead', 'top producer', 'million', 'broker'];
  const foundSpecialty = specialties.find(s => headline.includes(s));
  if (foundSpecialty) {
    hooks.push({
      base: 2,
      source: 'linkedin_headline',
      hook: `${foundSpecialty.charAt(0).toUpperCase() + foundSpecialty.slice(1)} agents protect their reputation with airtight disclosures. We make that effortless.`
    });
  }

  // Company fallback (base 1)
  const company = lead['Company Name'] || lead.company || '';
  if (company) {
    hooks.push({
      base: 1,
      source: 'company',
      hook: `Some ${company} agents are reviewing disclosures in 5 minutes now. Figured you'd want to know.`
    });
  }

  // Generic fallback (base 0)
  hooks.push({
    base: 0,
    source: 'generic',
    hook: `Most agents spend 4+ hours on disclosures per listing. We got it down to 5 minutes.`
  });

  // Calculate recency bonus and select best hook
  const daysSincePost = parseInt(lead.days_since_post);
  let recencyBonus = 0;
  if (!isNaN(daysSincePost)) {
    if (daysSincePost <= 3) recencyBonus = 2.0;
    else if (daysSincePost <= 7) recencyBonus = 1.5;
    else if (daysSincePost <= 14) recencyBonus = 1.0;
    else if (daysSincePost <= 30) recencyBonus = 0.5;
  }

  // Score and sort hooks
  const scoredHooks = hooks.map(h => ({
    ...h,
    finalScore: h.base + recencyBonus
  }));

  scoredHooks.sort((a, b) => b.finalScore - a.finalScore);
  const best = scoredHooks[0];

  return {
    best_hook: best.hook,
    hook_source: best.source,
    hook_score: best.finalScore
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RESCORE LEADS');
  console.log('═══════════════════════════════════════════════════════════════');

  const inputPath = path.resolve(inputFile);

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\nReading: ${inputPath}`);

  const csvContent = fs.readFileSync(inputPath, 'utf-8');
  const leads = parse(csvContent, { columns: true, skip_empty_lines: true });

  console.log(`Found ${leads.length} leads to rescore`);

  // Rescore each lead
  const stats = { Hot: 0, High: 0, Medium: 0, Low: 0 };

  for (const lead of leads) {
    // Recalculate ICP score
    const icpResult = calculateIcpScore(lead);
    lead.icp_score = icpResult.icp_score;
    lead.icp_tier = icpResult.icp_tier;
    lead.icp_breakdown = icpResult.icp_breakdown;

    // Regenerate hook (unless AI-generated)
    if (lead.hook_source !== 'AI-generated') {
      const hookResult = generateHook(lead);
      lead.best_hook = hookResult.best_hook;
      lead.hook_source = hookResult.hook_source;
      lead.hook_score = hookResult.hook_score;
    }

    stats[lead.icp_tier]++;
  }

  // Output
  const outputPath = outputFile
    ? path.resolve(outputFile)
    : inputPath.replace('.csv', '-rescored.csv');

  const output = stringify(leads, { header: true });
  fs.writeFileSync(outputPath, output);

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  RESCORE COMPLETE`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Total Leads: ${leads.length}`);
  console.log(`  Hot (90+):   ${stats.Hot}`);
  console.log(`  High (70-89): ${stats.High}`);
  console.log(`  Medium (55-69): ${stats.Medium}`);
  console.log(`  Low (<55):   ${stats.Low}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
