#!/usr/bin/env node
/**
 * Listings Scorer
 *
 * Calculates RECENCY and VOLUME scores from brokerage listing matches.
 * These scores are added to the ICP scoring system (max +30 points total).
 *
 * Scoring:
 *   RECENCY (max 15 points): Based on days since most recent listing
 *   VOLUME (max 15 points): Based on number of active listings
 *
 * Usage:
 *   node listings-scorer.js --input matched-leads.csv --output scored-leads.csv
 *
 * Or import the scoring functions directly:
 *   import { calculateRecencyScore, calculateVolumeScore } from './listings-scorer.js';
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

/**
 * RECENCY scoring tiers (max 15 points)
 *
 * Rationale: More recent listings indicate higher urgency for disclosure needs.
 * An agent who just listed a property is more likely to need Discloser soon.
 */
export const RECENCY_TIERS = [
  { maxDays: 7, points: 15, label: 'Just listed (7 days)' },
  { maxDays: 14, points: 12, label: 'Very recent (14 days)' },
  { maxDays: 30, points: 8, label: 'Recent (30 days)' },
  { maxDays: 60, points: 4, label: 'Somewhat recent (60 days)' },
  { maxDays: Infinity, points: 0, label: 'Older listing' },
];

/**
 * VOLUME scoring tiers (max 15 points)
 *
 * Rationale: Agents with more active listings have more disclosure work.
 * High-volume agents benefit most from efficiency tools.
 */
export const VOLUME_TIERS = [
  { minListings: 5, points: 15, label: 'High volume (5+ listings)' },
  { minListings: 3, points: 10, label: 'Active (3-4 listings)' },
  { minListings: 2, points: 6, label: 'Multiple (2 listings)' },
  { minListings: 1, points: 3, label: 'Single listing' },
  { minListings: 0, points: 0, label: 'No listings' },
];

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate RECENCY score based on days since most recent listing
 *
 * @param {number|string} daysSinceListing - Days since most recent listing
 * @returns {Object} - { points, tier, label }
 */
export function calculateRecencyScore(daysSinceListing) {
  const days = parseInt(daysSinceListing, 10);

  // Handle invalid/missing data
  if (isNaN(days) || days < 0 || days >= 999) {
    return { points: 0, tier: 'none', label: 'No listing data' };
  }

  for (const tier of RECENCY_TIERS) {
    if (days <= tier.maxDays) {
      return {
        points: tier.points,
        tier: tier.label,
        label: `+${tier.points}: ${tier.label}`,
      };
    }
  }

  return { points: 0, tier: 'none', label: 'No listing data' };
}

/**
 * Calculate VOLUME score based on number of active listings
 *
 * @param {number|string} listingCount - Number of active listings
 * @returns {Object} - { points, tier, label }
 */
export function calculateVolumeScore(listingCount) {
  const count = parseInt(listingCount, 10);

  // Handle invalid/missing data
  if (isNaN(count) || count < 0) {
    return { points: 0, tier: 'none', label: 'No listings' };
  }

  for (const tier of VOLUME_TIERS) {
    if (count >= tier.minListings) {
      return {
        points: tier.points,
        tier: tier.label,
        label: `+${tier.points}: ${tier.label}`,
      };
    }
  }

  return { points: 0, tier: 'none', label: 'No listings' };
}

/**
 * Calculate combined listing score for a lead
 *
 * @param {Object} lead - Lead object with listings_count and listings_days_since_most_recent
 * @returns {Object} - { recencyScore, volumeScore, totalScore, breakdown }
 */
export function calculateListingScores(lead) {
  const recency = calculateRecencyScore(lead.listings_days_since_most_recent);
  const volume = calculateVolumeScore(lead.listings_count);

  const breakdown = [];
  if (recency.points > 0) breakdown.push(recency.label);
  if (volume.points > 0) breakdown.push(volume.label);

  return {
    recencyScore: recency.points,
    volumeScore: volume.points,
    totalScore: recency.points + volume.points,
    recencyTier: recency.tier,
    volumeTier: volume.tier,
    breakdown,
  };
}

/**
 * Determine listing-based urgency level
 *
 * @param {Object} scores - Result from calculateListingScores
 * @returns {string} - 'Hot' | 'High' | 'Medium' | 'Low' | 'None'
 */
export function getListingUrgency(scores) {
  const { recencyScore, volumeScore } = scores;

  // Hot: Very recent + multiple listings
  if (recencyScore >= 12 && volumeScore >= 6) {
    return 'Hot';
  }

  // High: Recent listing OR high volume
  if (recencyScore >= 12 || volumeScore >= 10) {
    return 'High';
  }

  // Medium: Some recency or volume signal
  if (recencyScore >= 4 || volumeScore >= 3) {
    return 'Medium';
  }

  // Low: Has listings but not recent/volume
  if (recencyScore > 0 || volumeScore > 0) {
    return 'Low';
  }

  return 'None';
}

// ============================================================================
// LEAD SCORING
// ============================================================================

/**
 * Add listing scores to a lead
 */
function scoreLeadListings(lead) {
  const scored = { ...lead };

  // Skip if no listing match
  if (lead.listings_matched !== 'Yes') {
    scored.listings_recency_score = 0;
    scored.listings_volume_score = 0;
    scored.listings_total_score = 0;
    scored.listings_urgency = 'None';
    return scored;
  }

  const scores = calculateListingScores(lead);
  const urgency = getListingUrgency(scores);

  scored.listings_recency_score = scores.recencyScore;
  scored.listings_volume_score = scores.volumeScore;
  scored.listings_total_score = scores.totalScore;
  scored.listings_urgency = urgency;

  return scored;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
      case '-i':
        inputPath = args[++i];
        break;
      case '--output':
      case '-o':
        outputPath = args[++i];
        break;
    }
  }

  if (!inputPath) {
    console.log(`
Usage: node listings-scorer.js --input <leads.csv> [--output <output.csv>]

Options:
  --input, -i     Path to leads CSV with listing match data (required)
  --output, -o    Output CSV path (default: input with -scored suffix)

Example:
  node listings-scorer.js --input ../data/3operational/sf-feb-2026/enriched-matched.csv

Scoring System:
  RECENCY (max 15 points):
    - 7 days: +15
    - 14 days: +12
    - 30 days: +8
    - 60 days: +4

  VOLUME (max 15 points):
    - 5+ listings: +15
    - 3-4 listings: +10
    - 2 listings: +6
    - 1 listing: +3
`);
    process.exit(1);
  }

  // Resolve paths
  if (!inputPath.startsWith('/')) {
    inputPath = join(__dirname, inputPath);
  }

  if (!outputPath) {
    outputPath = inputPath.replace('.csv', '-scored.csv');
  } else if (!outputPath.startsWith('/')) {
    outputPath = join(__dirname, outputPath);
  }

  // Validate input exists
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Load and score leads
  console.log('Loading leads...');
  const content = readFileSync(inputPath, 'utf-8');
  const leads = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Loaded ${leads.length} leads`);

  console.log('Scoring listings...');
  const scoredLeads = leads.map(scoreLeadListings);

  // Calculate stats
  const stats = {
    total: scoredLeads.length,
    withListings: scoredLeads.filter(l => l.listings_matched === 'Yes').length,
    byUrgency: {},
    avgRecencyScore: 0,
    avgVolumeScore: 0,
  };

  let totalRecency = 0;
  let totalVolume = 0;
  let withScores = 0;

  for (const lead of scoredLeads) {
    const urgency = lead.listings_urgency || 'None';
    stats.byUrgency[urgency] = (stats.byUrgency[urgency] || 0) + 1;

    if (lead.listings_matched === 'Yes') {
      totalRecency += lead.listings_recency_score || 0;
      totalVolume += lead.listings_volume_score || 0;
      withScores++;
    }
  }

  if (withScores > 0) {
    stats.avgRecencyScore = (totalRecency / withScores).toFixed(1);
    stats.avgVolumeScore = (totalVolume / withScores).toFixed(1);
  }

  // Save output
  writeFileSync(outputPath, stringify(scoredLeads, { header: true }));
  console.log(`\nSaved: ${outputPath}`);

  // Print summary
  console.log(`
========================================
  LISTING SCORING COMPLETE
========================================

Total leads: ${stats.total}
With listings: ${stats.withListings} (${((stats.withListings / stats.total) * 100).toFixed(1)}%)

BY URGENCY:
  Hot: ${stats.byUrgency['Hot'] || 0}
  High: ${stats.byUrgency['High'] || 0}
  Medium: ${stats.byUrgency['Medium'] || 0}
  Low: ${stats.byUrgency['Low'] || 0}
  None: ${stats.byUrgency['None'] || 0}

AVERAGE SCORES (leads with listings):
  Recency: ${stats.avgRecencyScore} / 15
  Volume: ${stats.avgVolumeScore} / 15

Columns added:
  - listings_recency_score (0-15)
  - listings_volume_score (0-15)
  - listings_total_score (0-30)
  - listings_urgency (Hot/High/Medium/Low/None)
`);
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
