#!/usr/bin/env node
/**
 * Coldwell Banker Listings Scraper
 *
 * Custom Puppeteer scraper for Coldwell Banker listings in Northern California.
 * Scrapes agent search results and listing pages to extract active listings.
 *
 * Output: Array of listing objects with agent name, property details, and dates
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Coldwell Banker NorCal search URLs
const COLDWELL_SEARCH_URLS = [
  'https://www.coldwellbankerhomes.com/ca/san-francisco/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/oakland/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/palo-alto/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/san-jose/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/berkeley/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/marin-county/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/menlo-park/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/walnut-creek/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/los-altos/homes-for-sale/',
  'https://www.coldwellbankerhomes.com/ca/saratoga/homes-for-sale/',
];

/**
 * Random delay to avoid rate limiting
 */
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * Parse listing card from Coldwell Banker search results
 */
async function parseListingCard(card) {
  try {
    const listing = {
      listing_id: '',
      source: 'coldwell_banker',
      address: '',
      city: '',
      state: 'CA',
      zip: '',
      price: 0,
      agent_name: '',
      agent_email: '',
      brokerage: 'Coldwell Banker',
      listing_date: null,
      days_on_market: null,
      status: 'active',
      bedrooms: null,
      bathrooms: null,
      sqft: null,
      listing_url: '',
      scraped_at: new Date().toISOString(),
    };

    // Extract address
    const addressEl = await card.$('[class*="address"], .property-address, [data-testid="property-address"]');
    if (addressEl) {
      listing.address = await addressEl.evaluate(el => el.textContent.trim());
    }

    // Extract city/location
    const cityEl = await card.$('[class*="city"], .property-location, [data-testid="property-location"]');
    if (cityEl) {
      const cityText = await cityEl.evaluate(el => el.textContent.trim());
      // Parse "City, State ZIP" format
      const match = cityText.match(/^([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
      if (match) {
        listing.city = match[1];
        listing.zip = match[3] || '';
      } else {
        listing.city = cityText;
      }
    }

    // Extract price
    const priceEl = await card.$('[class*="price"], .property-price, [data-testid="price"]');
    if (priceEl) {
      const priceText = await priceEl.evaluate(el => el.textContent.trim());
      listing.price = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 0;
    }

    // Extract agent name
    const agentEl = await card.$('[class*="agent"], .listing-agent, [data-testid="agent-name"]');
    if (agentEl) {
      listing.agent_name = await agentEl.evaluate(el => el.textContent.trim());
    }

    // Extract listing URL
    const linkEl = await card.$('a[href*="/listing/"], a[href*="/property/"]');
    if (linkEl) {
      listing.listing_url = await linkEl.evaluate(el => el.href);
      // Extract listing ID from URL
      const idMatch = listing.listing_url.match(/\/(\d+)\/?/);
      if (idMatch) {
        listing.listing_id = `coldwell-${idMatch[1]}`;
      }
    }

    // Extract beds/baths/sqft
    const detailsEl = await card.$('[class*="details"], .property-details, [data-testid="property-details"]');
    if (detailsEl) {
      const detailsText = await detailsEl.evaluate(el => el.textContent.trim());
      const bedMatch = detailsText.match(/(\d+)\s*(?:bed|br)/i);
      const bathMatch = detailsText.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba)/i);
      const sqftMatch = detailsText.match(/([\d,]+)\s*(?:sq\s*ft|sqft)/i);

      if (bedMatch) listing.bedrooms = parseInt(bedMatch[1], 10);
      if (bathMatch) listing.bathrooms = parseFloat(bathMatch[1]);
      if (sqftMatch) listing.sqft = parseInt(sqftMatch[1].replace(',', ''), 10);
    }

    // Generate ID if not found
    if (!listing.listing_id) {
      listing.listing_id = `coldwell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    return listing;

  } catch (error) {
    console.error('[Coldwell] Error parsing listing card:', error.message);
    return null;
  }
}

/**
 * Scrape a single search results page
 */
async function scrapeSearchPage(page, url, verbose = false) {
  const listings = [];

  try {
    if (verbose) console.log(`[Coldwell] Navigating to ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Wait for listing cards to load
    await page.waitForSelector(
      '[class*="listing-card"], [class*="property-card"], [data-testid="property-card"]',
      { timeout: 10000 }
    ).catch(() => null);

    // Find all listing cards
    const cards = await page.$$('[class*="listing-card"], [class*="property-card"], [data-testid="property-card"]');
    if (verbose) console.log(`[Coldwell] Found ${cards.length} listing cards on page`);

    for (const card of cards) {
      const listing = await parseListingCard(card);
      if (listing && listing.agent_name) {
        listings.push(listing);
      }
    }

    // Check for pagination and get next page if exists
    const nextButton = await page.$('a[class*="next"], button[class*="next"], [data-testid="pagination-next"]');
    if (nextButton) {
      const isDisabled = await nextButton.evaluate(el =>
        el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true'
      );

      if (!isDisabled && listings.length < 50) { // Limit per city
        await nextButton.click();
        await randomDelay(3000, 5000);

        // Recursive call for next page
        const nextPageListings = await scrapeSearchPage(page, page.url(), verbose);
        listings.push(...nextPageListings);
      }
    }

  } catch (error) {
    if (verbose) console.log(`[Coldwell] Page scrape error for ${url}: ${error.message}`);
  }

  return listings;
}

/**
 * Main scraper function
 */
export async function scrapeColdwellListings(options = {}) {
  const {
    maxListings = 500,
    searchUrls = COLDWELL_SEARCH_URLS,
    verbose = false,
    headless = true,
  } = options;

  if (verbose) console.log(`[Coldwell] Starting scrape for ${searchUrls.length} areas...`);

  let browser;
  const allListings = [];
  const seenIds = new Set();

  try {
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
      ],
    });

    const page = await browser.newPage();

    // Set realistic viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    for (const url of searchUrls) {
      if (allListings.length >= maxListings) break;

      const pageListings = await scrapeSearchPage(page, url, verbose);

      for (const listing of pageListings) {
        if (seenIds.has(listing.listing_id)) continue;
        seenIds.add(listing.listing_id);
        allListings.push(listing);
      }

      if (verbose) console.log(`[Coldwell] Total listings so far: ${allListings.length}`);

      // Delay between cities
      await randomDelay(3000, 6000);
    }

    await browser.close();

    return {
      success: true,
      source: 'coldwell_banker',
      listings: allListings.slice(0, maxListings),
      count: Math.min(allListings.length, maxListings),
      scraped_at: new Date().toISOString(),
    };

  } catch (error) {
    if (browser) await browser.close();
    console.error(`[Coldwell] Scraping error: ${error.message}`);

    return {
      success: false,
      source: 'coldwell_banker',
      listings: allListings,
      count: allListings.length,
      error: error.message,
      scraped_at: new Date().toISOString(),
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  console.log('[Coldwell] Starting Northern California listings scrape...');

  const result = await scrapeColdwellListings({
    verbose: true,
    headless: true,
  });

  if (result.success) {
    const outputPath = join(__dirname, `../../../data/2listings/coldwell-listings-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[Coldwell] Saved ${result.count} listings to ${outputPath}`);
  } else {
    console.error(`[Coldwell] Scrape failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
