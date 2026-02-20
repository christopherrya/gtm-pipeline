#!/usr/bin/env node
/**
 * Intero Real Estate Services Listings Scraper
 *
 * Custom Puppeteer scraper for Intero listings in Northern California.
 * Intero is a significant regional brokerage with strong Bay Area presence.
 *
 * Output: Array of listing objects with agent name, property details, and dates
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Intero NorCal search URLs (Intero.com search format)
const INTERO_SEARCH_URLS = [
  'https://www.intero.com/search/for-sale/san-francisco-ca',
  'https://www.intero.com/search/for-sale/oakland-ca',
  'https://www.intero.com/search/for-sale/palo-alto-ca',
  'https://www.intero.com/search/for-sale/san-jose-ca',
  'https://www.intero.com/search/for-sale/los-gatos-ca',
  'https://www.intero.com/search/for-sale/saratoga-ca',
  'https://www.intero.com/search/for-sale/cupertino-ca',
  'https://www.intero.com/search/for-sale/campbell-ca',
  'https://www.intero.com/search/for-sale/sunnyvale-ca',
  'https://www.intero.com/search/for-sale/mountain-view-ca',
  'https://www.intero.com/search/for-sale/santa-clara-ca',
  'https://www.intero.com/search/for-sale/fremont-ca',
];

/**
 * Random delay to avoid rate limiting
 */
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * Parse listing card from Intero search results
 */
async function parseListingCard(card) {
  try {
    const listing = {
      listing_id: '',
      source: 'intero',
      address: '',
      city: '',
      state: 'CA',
      zip: '',
      price: 0,
      agent_name: '',
      agent_email: '',
      brokerage: 'Intero Real Estate Services',
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
    const addressSelectors = [
      '.property-address',
      '.listing-address',
      '[class*="address"]',
      '.address',
      'h3',
      'h2',
    ];

    for (const selector of addressSelectors) {
      const addressEl = await card.$(selector);
      if (addressEl) {
        const text = await addressEl.evaluate(el => el.textContent.trim());
        // Look for street address pattern
        if (text && /\d+\s+[A-Za-z]/.test(text)) {
          listing.address = text.split('\n')[0].trim();
          break;
        }
      }
    }

    // Extract city/location
    const locationSelectors = [
      '.property-city',
      '.listing-location',
      '[class*="city"]',
      '[class*="location"]',
      '.city-state',
    ];

    for (const selector of locationSelectors) {
      const locationEl = await card.$(selector);
      if (locationEl) {
        const text = await locationEl.evaluate(el => el.textContent.trim());
        if (text) {
          // Parse "City, CA 95123" format
          const match = text.match(/^([A-Za-z\s]+),?\s*(?:CA)?\s*(\d{5})?/i);
          if (match) {
            listing.city = match[1].trim();
            listing.zip = match[2] || '';
          }
          break;
        }
      }
    }

    // Extract price
    const priceSelectors = [
      '.property-price',
      '.listing-price',
      '[class*="price"]',
      '.price',
    ];

    for (const selector of priceSelectors) {
      const priceEl = await card.$(selector);
      if (priceEl) {
        const priceText = await priceEl.evaluate(el => el.textContent.trim());
        if (priceText.includes('$') || /\d{3,}/.test(priceText)) {
          listing.price = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 0;
          break;
        }
      }
    }

    // Extract agent name
    const agentSelectors = [
      '.listing-agent',
      '.agent-name',
      '[class*="agent"]',
      '.broker-name',
      '.realtor-name',
    ];

    for (const selector of agentSelectors) {
      const agentEl = await card.$(selector);
      if (agentEl) {
        const text = await agentEl.evaluate(el => el.textContent.trim());
        if (text && text.length > 3 && text.length < 60 && !text.includes('$')) {
          // Clean up agent name
          listing.agent_name = text
            .replace(/^(Listed by|Agent:|Presented by|Contact:)\s*/i, '')
            .replace(/\s*(Intero|Real Estate|DRE#?\d+|License#?\d+).*$/i, '')
            .trim();
          break;
        }
      }
    }

    // Extract listing URL and ID
    const linkEl = await card.$('a[href*="/listing/"], a[href*="/property/"], a[href*="/homes/"]');
    if (linkEl) {
      listing.listing_url = await linkEl.evaluate(el => el.href);
      // Extract listing ID from URL patterns
      const idMatch = listing.listing_url.match(/\/(\d{6,})|listing-(\d+)|mls-([A-Z0-9]+)/i);
      if (idMatch) {
        listing.listing_id = `intero-${idMatch[1] || idMatch[2] || idMatch[3]}`;
      }
    }

    // Extract property details (beds/baths/sqft)
    const detailsText = await card.evaluate(el => el.textContent);

    const bedMatch = detailsText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
    const bathMatch = detailsText.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba|bathroom)/i);
    const sqftMatch = detailsText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|sf)/i);

    if (bedMatch) listing.bedrooms = parseInt(bedMatch[1], 10);
    if (bathMatch) listing.bathrooms = parseFloat(bathMatch[1]);
    if (sqftMatch) listing.sqft = parseInt(sqftMatch[1].replace(',', ''), 10);

    // Look for days on market if available
    const domMatch = detailsText.match(/(\d+)\s*(?:days?\s*on\s*market|DOM)/i);
    if (domMatch) {
      listing.days_on_market = parseInt(domMatch[1], 10);
      // Calculate approximate listing date
      listing.listing_date = new Date(
        Date.now() - listing.days_on_market * 24 * 60 * 60 * 1000
      ).toISOString().split('T')[0];
    }

    // Generate ID if not found
    if (!listing.listing_id) {
      listing.listing_id = `intero-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    return listing;

  } catch (error) {
    console.error('[Intero] Error parsing listing card:', error.message);
    return null;
  }
}

/**
 * Scrape a single search results page
 */
async function scrapeSearchPage(page, url, verbose = false) {
  const listings = [];

  try {
    if (verbose) console.log(`[Intero] Navigating to ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(2000, 4000);

    // Scroll to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });

    await randomDelay(2000, 3000);

    // Try multiple selectors for listing cards
    const cardSelectors = [
      '.listing-card',
      '.property-card',
      '[class*="ListingCard"]',
      '[class*="PropertyCard"]',
      '.search-result',
      '[class*="result-item"]',
      'article',
      '.property-item',
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      cards = await page.$$(selector);
      if (cards.length > 0) {
        if (verbose) console.log(`[Intero] Found ${cards.length} cards using selector: ${selector}`);
        break;
      }
    }

    if (cards.length === 0) {
      if (verbose) console.log(`[Intero] No listing cards found on ${url}`);
      return listings;
    }

    for (const card of cards) {
      const listing = await parseListingCard(card);
      if (listing && listing.agent_name && listing.address) {
        listings.push(listing);
      }
    }

    // Handle pagination
    const paginationSelectors = [
      'a.next',
      '.pagination-next',
      '[class*="next"]',
      'button[aria-label="Next"]',
    ];

    for (const selector of paginationSelectors) {
      const nextBtn = await page.$(selector);
      if (nextBtn && listings.length < 50) {
        const isDisabled = await nextBtn.evaluate(el =>
          el.disabled || el.classList.contains('disabled')
        ).catch(() => true);

        if (!isDisabled) {
          try {
            await nextBtn.click();
            await randomDelay(3000, 5000);

            // Get additional listings
            const moreCards = await page.$$('[class*="listing"], [class*="property"], article');
            for (const card of moreCards) {
              const listing = await parseListingCard(card);
              if (listing && listing.agent_name && listing.address) {
                if (!listings.find(l => l.listing_id === listing.listing_id)) {
                  listings.push(listing);
                }
              }
            }
          } catch (e) {
            // Pagination failed, continue with current listings
          }
        }
        break;
      }
    }

  } catch (error) {
    if (verbose) console.log(`[Intero] Page scrape error for ${url}: ${error.message}`);
  }

  return listings;
}

/**
 * Main scraper function
 */
export async function scrapeInteroListings(options = {}) {
  const {
    maxListings = 400,
    searchUrls = INTERO_SEARCH_URLS,
    verbose = false,
    headless = true,
  } = options;

  if (verbose) console.log(`[Intero] Starting scrape for ${searchUrls.length} areas...`);

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

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', req => {
      const resourceType = req.resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (const url of searchUrls) {
      if (allListings.length >= maxListings) break;

      const pageListings = await scrapeSearchPage(page, url, verbose);

      for (const listing of pageListings) {
        if (seenIds.has(listing.listing_id)) continue;
        seenIds.add(listing.listing_id);
        allListings.push(listing);
      }

      if (verbose) console.log(`[Intero] Total listings so far: ${allListings.length}`);

      // Delay between cities
      await randomDelay(3000, 6000);
    }

    await browser.close();

    return {
      success: true,
      source: 'intero',
      listings: allListings.slice(0, maxListings),
      count: Math.min(allListings.length, maxListings),
      scraped_at: new Date().toISOString(),
    };

  } catch (error) {
    if (browser) await browser.close();
    console.error(`[Intero] Scraping error: ${error.message}`);

    return {
      success: false,
      source: 'intero',
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
  console.log('[Intero] Starting Northern California listings scrape...');

  const result = await scrapeInteroListings({
    verbose: true,
    headless: true,
  });

  if (result.success) {
    const outputPath = join(__dirname, `../../../data/2listings/intero-listings-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[Intero] Saved ${result.count} listings to ${outputPath}`);
  } else {
    console.error(`[Intero] Scrape failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
