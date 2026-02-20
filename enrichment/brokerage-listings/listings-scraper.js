#!/usr/bin/env node
/**
 * Master Listings Scraper Orchestrator
 *
 * Orchestrates all four brokerage scrapers (Compass, Coldwell Banker, Sotheby's, Intero)
 * and produces unified listing output for matching against lead database.
 *
 * Usage:
 *   node listings-scraper.js                    # Run all scrapers
 *   node listings-scraper.js --source compass   # Run single source
 *   node listings-scraper.js --test             # Test mode (limited results)
 */

import { ApifyClient } from 'apify-client';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

import { scrapeCompassListings } from './scrapers/compass-scraper.js';
import { scrapeColdwellListings } from './scrapers/coldwell-scraper.js';
import { scrapeSothebysListings } from './scrapers/sothebys-scraper.js';
import { scrapeInteroListings } from './scrapers/intero-scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
config({ path: join(__dirname, '../../.env') });

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOURCES = ['compass', 'coldwell_banker', 'sothebys', 'intero'];

const SOURCE_CONFIG = {
  compass: {
    name: 'Compass',
    scraper: scrapeCompassListings,
    usesApify: true,
    maxListings: 500,
  },
  coldwell_banker: {
    name: 'Coldwell Banker',
    scraper: scrapeColdwellListings,
    usesApify: false,
    maxListings: 500,
  },
  sothebys: {
    name: "Sotheby's",
    scraper: scrapeSothebysListings,
    usesApify: false,
    maxListings: 400,
  },
  intero: {
    name: 'Intero',
    scraper: scrapeInteroListings,
    usesApify: false,
    maxListings: 400,
  },
};

// ============================================================================
// UTILITIES
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    source: null, // null = all sources
    test: false,
    verbose: true,
    outputDir: join(__dirname, '../../data/2listings'),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
      case '-s':
        options.source = args[++i];
        break;
      case '--test':
      case '-t':
        options.test = true;
        break;
      case '--quiet':
      case '-q':
        options.verbose = false;
        break;
      case '--output':
      case '-o':
        options.outputDir = args[++i];
        break;
    }
  }

  return options;
}

function log(message, type = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[OK]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    step: '\x1b[35m[STEP]\x1b[0m',
  };
  console.log(`${prefix[type] || ''} ${message}`);
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Run a single source scraper
 */
async function runSourceScraper(sourceKey, apifyClient, options) {
  const sourceConfig = SOURCE_CONFIG[sourceKey];
  if (!sourceConfig) {
    log(`Unknown source: ${sourceKey}`, 'error');
    return null;
  }

  log(`Starting ${sourceConfig.name} scraper...`, 'step');

  const scraperOptions = {
    verbose: options.verbose,
    maxListings: options.test ? 50 : sourceConfig.maxListings,
    headless: true,
  };

  let result;
  if (sourceConfig.usesApify) {
    result = await sourceConfig.scraper(apifyClient, scraperOptions);
  } else {
    result = await sourceConfig.scraper(scraperOptions);
  }

  if (result.success) {
    log(`${sourceConfig.name}: ${result.count} listings scraped`, 'success');
  } else {
    log(`${sourceConfig.name}: Scrape failed - ${result.error}`, 'warn');
  }

  return result;
}

/**
 * Merge all source results into unified output
 */
function mergeResults(results) {
  const allListings = [];
  const stats = {
    total: 0,
    by_source: {},
    by_city: {},
    avg_price: 0,
    with_agent_name: 0,
    with_email: 0,
  };

  let totalPrice = 0;

  for (const result of results) {
    if (!result || !result.listings) continue;

    stats.by_source[result.source] = result.count;

    for (const listing of result.listings) {
      allListings.push(listing);

      // Update stats
      stats.total++;
      if (listing.agent_name) stats.with_agent_name++;
      if (listing.agent_email) stats.with_email++;
      if (listing.price) totalPrice += listing.price;

      // Track by city
      const city = listing.city || 'Unknown';
      stats.by_city[city] = (stats.by_city[city] || 0) + 1;
    }
  }

  stats.avg_price = stats.total > 0 ? Math.round(totalPrice / stats.total) : 0;

  return { listings: allListings, stats };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`
========================================
  BROKERAGE LISTINGS SCRAPER
  Northern California Market
========================================
`);

  const options = parseArgs();

  // Ensure output directory exists
  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  // Initialize Apify client (for Compass)
  let apifyClient = null;
  if (process.env.APIFY_API_KEY) {
    apifyClient = new ApifyClient({ token: process.env.APIFY_API_KEY });
    log('Apify client initialized');
  } else {
    log('APIFY_API_KEY not found - Compass scraper will be skipped', 'warn');
  }

  // Determine which sources to scrape
  let sourcesToScrape = SOURCES;
  if (options.source) {
    if (!SOURCE_CONFIG[options.source]) {
      log(`Invalid source: ${options.source}. Valid options: ${SOURCES.join(', ')}`, 'error');
      process.exit(1);
    }
    sourcesToScrape = [options.source];
  }

  // Skip Compass if no Apify key
  if (!apifyClient) {
    sourcesToScrape = sourcesToScrape.filter(s => s !== 'compass');
  }

  if (options.test) {
    log('TEST MODE: Limited to 50 listings per source', 'warn');
  }

  // Run scrapers
  const results = [];
  const dateStr = new Date().toISOString().split('T')[0];

  for (const sourceKey of sourcesToScrape) {
    try {
      const result = await runSourceScraper(sourceKey, apifyClient, options);
      if (result) {
        results.push(result);

        // Save individual source result
        const sourcePath = join(options.outputDir, `${sourceKey}-listings-${dateStr}.json`);
        writeFileSync(sourcePath, JSON.stringify(result, null, 2));
        log(`Saved: ${sourcePath}`, 'success');
      }
    } catch (error) {
      log(`${sourceKey} scraper error: ${error.message}`, 'error');
    }
  }

  // Merge all results
  const { listings, stats } = mergeResults(results);

  // Save merged output
  const mergedOutput = {
    scraped_at: new Date().toISOString(),
    sources: sourcesToScrape,
    stats,
    listings,
  };

  const mergedPath = join(options.outputDir, `all-listings-${dateStr}.json`);
  writeFileSync(mergedPath, JSON.stringify(mergedOutput, null, 2));
  log(`Saved merged listings: ${mergedPath}`, 'success');

  // Print summary
  console.log(`
========================================
  SCRAPE COMPLETE
========================================

TOTAL LISTINGS: ${stats.total}

BY SOURCE:
${Object.entries(stats.by_source).map(([k, v]) => `  ${SOURCE_CONFIG[k]?.name || k}: ${v}`).join('\n')}

BY CITY (Top 10):
${Object.entries(stats.by_city)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')}

AGENT DATA:
  With agent name: ${stats.with_agent_name} (${((stats.with_agent_name / stats.total) * 100).toFixed(1)}%)
  With agent email: ${stats.with_email} (${((stats.with_email / stats.total) * 100).toFixed(1)}%)
  Avg listing price: $${stats.avg_price.toLocaleString()}

OUTPUT:
  ${mergedPath}
`);
}

main().catch(err => {
  log(err.message, 'error');
  process.exit(1);
});
