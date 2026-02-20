#!/usr/bin/env node
/**
 * Listings Matcher
 *
 * Cross-references scraped brokerage listings with the lead database.
 * Uses fuzzy name matching to handle variations in agent name formatting.
 *
 * Output: Enriched leads with listing match data
 *
 * Usage:
 *   node listings-matcher.js --leads ../data/1raw/sf-feb-2026.csv --listings ../data/2listings/all-listings-2026-02-05.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareTwoStrings } from 'string-similarity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const MATCH_THRESHOLD = 0.85; // 85% string similarity required for fuzzy match
const COMPANY_MATCH_BOOST = 0.10; // Boost if company also matches

// Company name mappings for normalization
const COMPANY_ALIASES = {
  'compass': ['compass', 'compass realty', 'compass real estate'],
  'coldwell_banker': ['coldwell banker', 'coldwell', 'cb', 'coldwell banker residential'],
  'sothebys': ['sotheby', "sotheby's", 'sothebys', 'sotheby international', 'sothebys international realty'],
  'intero': ['intero', 'intero real estate', 'intero real estate services'],
  'keller_williams': ['keller williams', 'kw', 'keller williams realty'],
  'redfin': ['redfin'],
};

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Normalize a name for comparison
 * - Lowercase
 * - Remove titles (Jr., Sr., III, etc.)
 * - Remove middle names/initials for better matching
 * - Trim whitespace
 */
function normalizeName(name) {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/,?\s*(jr\.?|sr\.?|iii|ii|iv|esq\.?|phd|md|dre#?\d*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract first and last name from full name
 */
function splitName(fullName) {
  const normalized = normalizeName(fullName);
  const parts = normalized.split(' ').filter(p => p.length > 0);

  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };

  // Take first and last parts, skip middle
  return {
    first: parts[0],
    last: parts[parts.length - 1],
  };
}

/**
 * Normalize company name for comparison
 */
function normalizeCompany(company) {
  if (!company) return '';

  const normalized = company
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+(real\s+estate|realty|properties|group|inc|llc|corp)$/i, '')
    .trim();

  // Check for known aliases
  for (const [canonical, aliases] of Object.entries(COMPANY_ALIASES)) {
    for (const alias of aliases) {
      if (normalized.includes(alias)) {
        return canonical;
      }
    }
  }

  return normalized;
}

// ============================================================================
// MATCHING
// ============================================================================

/**
 * Calculate match score between a lead and a listing agent
 */
function calculateMatchScore(lead, listing) {
  const leadFirst = normalizeName(lead['First Name'] || '');
  const leadLast = normalizeName(lead['Last Name'] || '');
  const leadCompany = normalizeCompany(lead['Company Name'] || '');

  const listingName = splitName(listing.agent_name);
  const listingCompany = normalizeCompany(listing.brokerage || '');

  // Calculate name similarity
  const firstNameSim = compareTwoStrings(leadFirst, listingName.first);
  const lastNameSim = compareTwoStrings(leadLast, listingName.last);

  // Weight last name more heavily (more unique)
  let nameScore = (firstNameSim * 0.4) + (lastNameSim * 0.6);

  // Boost if company matches
  let companyBoost = 0;
  if (leadCompany && listingCompany) {
    if (leadCompany === listingCompany) {
      companyBoost = COMPANY_MATCH_BOOST;
    } else if (compareTwoStrings(leadCompany, listingCompany) > 0.7) {
      companyBoost = COMPANY_MATCH_BOOST / 2;
    }
  }

  const totalScore = Math.min(1.0, nameScore + companyBoost);

  return {
    score: totalScore,
    nameScore,
    companyBoost,
    leadName: `${leadFirst} ${leadLast}`,
    listingName: `${listingName.first} ${listingName.last}`,
  };
}

/**
 * Find all matching listings for a lead
 */
function findMatchingListings(lead, listings) {
  const matches = [];

  for (const listing of listings) {
    if (!listing.agent_name) continue;

    const matchResult = calculateMatchScore(lead, listing);

    if (matchResult.score >= MATCH_THRESHOLD) {
      matches.push({
        listing,
        ...matchResult,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}

// ============================================================================
// ENRICHMENT
// ============================================================================

/**
 * Enrich a lead with listing match data
 */
function enrichLeadWithListings(lead, matches) {
  const enriched = { ...lead };

  if (matches.length === 0) {
    enriched.listings_matched = 'No';
    enriched.listings_count = 0;
    enriched.listings_most_recent_date = '';
    enriched.listings_days_since_most_recent = '';
    enriched.listings_addresses = '';
    enriched.listings_total_value = 0;
    enriched.listings_avg_price = 0;
    enriched.listings_recency_score = 0;
    enriched.listings_volume_score = 0;
    return enriched;
  }

  const matchedListings = matches.map(m => m.listing);

  // Calculate days since most recent listing
  let mostRecentDate = null;
  let daysSinceMostRecent = 999;

  for (const listing of matchedListings) {
    if (listing.listing_date) {
      const listingDate = new Date(listing.listing_date);
      if (!mostRecentDate || listingDate > mostRecentDate) {
        mostRecentDate = listingDate;
      }
    } else if (listing.days_on_market !== null && listing.days_on_market !== undefined) {
      // Estimate listing date from days on market
      const estimatedDate = new Date(Date.now() - listing.days_on_market * 24 * 60 * 60 * 1000);
      if (!mostRecentDate || estimatedDate > mostRecentDate) {
        mostRecentDate = estimatedDate;
      }
    }
  }

  if (mostRecentDate) {
    daysSinceMostRecent = Math.floor((Date.now() - mostRecentDate) / (1000 * 60 * 60 * 24));
  }

  // Calculate total and average price
  const prices = matchedListings.map(l => l.price).filter(p => p && p > 0);
  const totalValue = prices.reduce((sum, p) => sum + p, 0);
  const avgPrice = prices.length > 0 ? Math.round(totalValue / prices.length) : 0;

  // Extract addresses
  const addresses = matchedListings
    .map(l => l.address)
    .filter(a => a)
    .slice(0, 5);

  // Calculate RECENCY score (max 15 points)
  let recencyScore = 0;
  if (daysSinceMostRecent <= 7) {
    recencyScore = 15;
  } else if (daysSinceMostRecent <= 14) {
    recencyScore = 12;
  } else if (daysSinceMostRecent <= 30) {
    recencyScore = 8;
  } else if (daysSinceMostRecent <= 60) {
    recencyScore = 4;
  }

  // Calculate VOLUME score (max 15 points)
  let volumeScore = 0;
  const listingCount = matchedListings.length;
  if (listingCount >= 5) {
    volumeScore = 15;
  } else if (listingCount >= 3) {
    volumeScore = 10;
  } else if (listingCount >= 2) {
    volumeScore = 6;
  } else if (listingCount >= 1) {
    volumeScore = 3;
  }

  // Set enriched fields
  enriched.listings_matched = 'Yes';
  enriched.listings_count = listingCount;
  enriched.listings_most_recent_date = mostRecentDate ? mostRecentDate.toISOString().split('T')[0] : '';
  enriched.listings_days_since_most_recent = daysSinceMostRecent < 999 ? daysSinceMostRecent : '';
  enriched.listings_addresses = addresses.join(' | ');
  enriched.listings_total_value = totalValue;
  enriched.listings_avg_price = avgPrice;
  enriched.listings_recency_score = recencyScore;
  enriched.listings_volume_score = volumeScore;

  return enriched;
}

// ============================================================================
// MAIN
// ============================================================================

/**
 * Match listings to leads (exported for use by other modules)
 */
export function matchListingsToLeads(leads, listings, options = {}) {
  const { verbose = false } = options;

  const enrichedLeads = [];
  let matchedCount = 0;

  for (const lead of leads) {
    const matches = findMatchingListings(lead, listings);

    if (matches.length > 0) {
      matchedCount++;
      if (verbose) {
        console.log(`Match: ${lead['First Name']} ${lead['Last Name']} -> ${matches.length} listings`);
      }
    }

    const enriched = enrichLeadWithListings(lead, matches);
    enrichedLeads.push(enriched);
  }

  return {
    leads: enrichedLeads,
    stats: {
      total_leads: leads.length,
      matched_leads: matchedCount,
      match_rate: ((matchedCount / leads.length) * 100).toFixed(1),
    },
  };
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  let leadsPath = null;
  let listingsPath = null;
  let outputPath = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--leads':
      case '-l':
        leadsPath = args[++i];
        break;
      case '--listings':
        listingsPath = args[++i];
        break;
      case '--output':
      case '-o':
        outputPath = args[++i];
        break;
      case '--verbose':
      case '-v':
        verbose = true;
        break;
    }
  }

  if (!leadsPath || !listingsPath) {
    console.log(`
Usage: node listings-matcher.js --leads <leads.csv> --listings <listings.json> [options]

Options:
  --leads, -l      Path to leads CSV file (required)
  --listings       Path to listings JSON file (required)
  --output, -o     Output CSV path (default: leads file with -matched suffix)
  --verbose, -v    Show match details

Example:
  node listings-matcher.js \\
    --leads ../data/1raw/sf-feb-2026.csv \\
    --listings ../data/2listings/all-listings-2026-02-05.json
`);
    process.exit(1);
  }

  // Resolve paths
  if (!leadsPath.startsWith('/')) {
    leadsPath = join(__dirname, leadsPath);
  }
  if (!listingsPath.startsWith('/')) {
    listingsPath = join(__dirname, listingsPath);
  }

  // Validate files exist
  if (!existsSync(leadsPath)) {
    console.error(`Leads file not found: ${leadsPath}`);
    process.exit(1);
  }
  if (!existsSync(listingsPath)) {
    console.error(`Listings file not found: ${listingsPath}`);
    process.exit(1);
  }

  // Load data
  console.log('Loading leads...');
  const leadsContent = readFileSync(leadsPath, 'utf-8');
  const leads = parse(leadsContent, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Loaded ${leads.length} leads`);

  console.log('Loading listings...');
  const listingsContent = readFileSync(listingsPath, 'utf-8');
  const listingsData = JSON.parse(listingsContent);
  const listings = listingsData.listings || listingsData;
  console.log(`Loaded ${listings.length} listings`);

  // Run matching
  console.log('\nMatching listings to leads...');
  const result = matchListingsToLeads(leads, listings, { verbose });

  // Output path
  if (!outputPath) {
    outputPath = leadsPath.replace('.csv', '-matched.csv');
  }

  // Save results
  writeFileSync(outputPath, stringify(result.leads, { header: true }));
  console.log(`\nSaved: ${outputPath}`);

  // Print summary
  console.log(`
========================================
  MATCHING COMPLETE
========================================

Total leads: ${result.stats.total_leads}
Matched leads: ${result.stats.matched_leads} (${result.stats.match_rate}%)

New columns added:
  - listings_matched
  - listings_count
  - listings_most_recent_date
  - listings_days_since_most_recent
  - listings_addresses
  - listings_total_value
  - listings_avg_price
  - listings_recency_score (0-15)
  - listings_volume_score (0-15)
`);
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
