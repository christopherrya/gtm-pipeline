#!/usr/bin/env node
/**
 * Compass Listings Scraper
 *
 * Uses mosaic/compass-scraper Apify actor to scrape Northern California
 * Compass listings and extract agent information.
 *
 * Output: Array of listing objects with agent name, property details, and dates
 */

import { ApifyClient } from 'apify-client';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPASS_ACTOR = 'mosaic/compass-scraper';

// Northern California search areas for Compass
const NORCAL_COMPASS_URLS = [
  'https://www.compass.com/for-sale/san-francisco-ca/',
  'https://www.compass.com/for-sale/oakland-ca/',
  'https://www.compass.com/for-sale/palo-alto-ca/',
  'https://www.compass.com/for-sale/san-jose-ca/',
  'https://www.compass.com/for-sale/berkeley-ca/',
  'https://www.compass.com/for-sale/marin-county-ca/',
  'https://www.compass.com/for-sale/menlo-park-ca/',
  'https://www.compass.com/for-sale/atherton-ca/',
  'https://www.compass.com/for-sale/los-altos-ca/',
  'https://www.compass.com/for-sale/saratoga-ca/',
  'https://www.compass.com/for-sale/walnut-creek-ca/',
];

/**
 * Parse Compass listing data into standardized schema
 */
function parseCompassListing(item) {
  // Extract agent info from the listing
  const agentName = item.listingAgent?.name || item.agent?.name || '';
  const agentEmail = item.listingAgent?.email || item.agent?.email || '';

  // Parse listing date
  let listingDate = null;
  let daysOnMarket = null;

  if (item.listDate || item.listingDate) {
    const dateStr = item.listDate || item.listingDate;
    listingDate = new Date(dateStr).toISOString().split('T')[0];
    daysOnMarket = Math.floor((Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
  } else if (item.daysOnMarket) {
    daysOnMarket = parseInt(item.daysOnMarket, 10);
    listingDate = new Date(Date.now() - daysOnMarket * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  return {
    listing_id: item.listingId || item.id || `compass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'compass',
    address: item.address?.streetAddress || item.streetAddress || item.address || '',
    city: item.address?.city || item.city || '',
    state: 'CA',
    zip: item.address?.postalCode || item.zip || item.postalCode || '',
    price: parseInt(item.price || item.listPrice || 0, 10),
    agent_name: agentName,
    agent_email: agentEmail,
    brokerage: 'Compass',
    listing_date: listingDate,
    days_on_market: daysOnMarket,
    status: (item.status || 'active').toLowerCase(),
    bedrooms: item.beds || item.bedrooms || null,
    bathrooms: item.baths || item.bathrooms || null,
    sqft: item.sqft || item.livingArea || null,
    listing_url: item.url || item.detailUrl || '',
    scraped_at: new Date().toISOString(),
  };
}

/**
 * Run Compass scraper via Apify
 */
export async function scrapeCompassListings(client, options = {}) {
  const {
    maxListings = 500,
    searchUrls = NORCAL_COMPASS_URLS,
    verbose = false
  } = options;

  if (verbose) console.log(`[Compass] Starting scrape for ${searchUrls.length} areas...`);

  try {
    const run = await client.actor(COMPASS_ACTOR).call({
      startUrls: searchUrls.map(url => ({ url })),
      maxItems: maxListings,
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
      },
    }, {
      timeout: 1200, // 20 minutes
      memory: 2048,
    });

    if (verbose) console.log(`[Compass] Scrape finished with status: ${run.status}`);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (verbose) console.log(`[Compass] Retrieved ${items.length} raw listings`);

    // Parse and deduplicate listings
    const listings = [];
    const seenIds = new Set();

    for (const item of items) {
      const parsed = parseCompassListing(item);

      // Skip if no agent name (can't match to leads)
      if (!parsed.agent_name) continue;

      // Deduplicate by listing_id
      if (seenIds.has(parsed.listing_id)) continue;
      seenIds.add(parsed.listing_id);

      listings.push(parsed);
    }

    if (verbose) console.log(`[Compass] Parsed ${listings.length} valid listings with agent info`);

    return {
      success: true,
      source: 'compass',
      listings,
      count: listings.length,
      scraped_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Compass] Scraping error: ${error.message}`);
    return {
      success: false,
      source: 'compass',
      listings: [],
      count: 0,
      error: error.message,
      scraped_at: new Date().toISOString(),
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  const { config } = await import('dotenv');
  config({ path: join(__dirname, '../../../.env') });

  if (!process.env.APIFY_API_KEY) {
    console.error('[Compass] APIFY_API_KEY not found in .env');
    process.exit(1);
  }

  const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

  console.log('[Compass] Starting Northern California listings scrape...');
  const result = await scrapeCompassListings(client, { verbose: true });

  if (result.success) {
    const outputPath = join(__dirname, `../../../data/2listings/compass-listings-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[Compass] Saved ${result.count} listings to ${outputPath}`);
  } else {
    console.error(`[Compass] Scrape failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
