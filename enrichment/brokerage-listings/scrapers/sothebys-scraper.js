#!/usr/bin/env node
/**
 * Sotheby's International Realty Listings Scraper
 *
 * Custom Puppeteer scraper for Sotheby's listings in Northern California.
 * Targets luxury segment - typically higher price points and premium agents.
 *
 * Output: Array of listing objects with agent name, property details, and dates
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sotheby's NorCal search URLs
const SOTHEBYS_SEARCH_URLS = [
  'https://www.sothebysrealty.com/eng/sales/san-francisco-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/oakland-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/palo-alto-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/san-jose-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/berkeley-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/marin-county-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/menlo-park-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/atherton-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/los-altos-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/saratoga-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/tiburon-ca-usa',
  'https://www.sothebysrealty.com/eng/sales/ross-ca-usa',
];

/**
 * Random delay to avoid rate limiting
 */
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * Parse listing card from Sotheby's search results
 */
async function parseListingCard(card, page) {
  try {
    const listing = {
      listing_id: '',
      source: 'sothebys',
      address: '',
      city: '',
      state: 'CA',
      zip: '',
      price: 0,
      agent_name: '',
      agent_email: '',
      brokerage: "Sotheby's International Realty",
      listing_date: null,
      days_on_market: null,
      status: 'active',
      bedrooms: null,
      bathrooms: null,
      sqft: null,
      listing_url: '',
      scraped_at: new Date().toISOString(),
    };

    // Extract address - Sotheby's uses various class patterns
    const addressSelectors = [
      '.listing-address',
      '[class*="Address"]',
      '[class*="address"]',
      'h2',
      'h3',
    ];

    for (const selector of addressSelectors) {
      const addressEl = await card.$(selector);
      if (addressEl) {
        const text = await addressEl.evaluate(el => el.textContent.trim());
        if (text && text.length > 5 && /\d/.test(text)) {
          listing.address = text;
          break;
        }
      }
    }

    // Extract city from card or URL context
    const locationSelectors = [
      '.listing-location',
      '[class*="Location"]',
      '[class*="city"]',
      '.sub-title',
    ];

    for (const selector of locationSelectors) {
      const locationEl = await card.$(selector);
      if (locationEl) {
        const text = await locationEl.evaluate(el => el.textContent.trim());
        if (text && !text.includes('$')) {
          // Parse city from "City, State" or just city
          const match = text.match(/^([A-Za-z\s]+)/);
          if (match) {
            listing.city = match[1].trim();
          }
          break;
        }
      }
    }

    // Extract price
    const priceSelectors = [
      '.listing-price',
      '[class*="Price"]',
      '[class*="price"]',
      'span.price',
    ];

    for (const selector of priceSelectors) {
      const priceEl = await card.$(selector);
      if (priceEl) {
        const priceText = await priceEl.evaluate(el => el.textContent.trim());
        if (priceText.includes('$')) {
          listing.price = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 0;
          break;
        }
      }
    }

    // Extract agent name
    const agentSelectors = [
      '.listing-agent',
      '[class*="Agent"]',
      '[class*="agent"]',
      '.broker-name',
      '[class*="Broker"]',
    ];

    for (const selector of agentSelectors) {
      const agentEl = await card.$(selector);
      if (agentEl) {
        const text = await agentEl.evaluate(el => el.textContent.trim());
        // Filter out non-name text
        if (text && !text.includes('$') && !text.includes('bed') && text.length > 3 && text.length < 50) {
          listing.agent_name = text.replace(/^(Listed by|Agent:|Presented by)\s*/i, '').trim();
          break;
        }
      }
    }

    // Extract listing URL
    const linkEl = await card.$('a[href*="/property/"], a[href*="/listing/"], a[href*="/eng/sales/detail/"]');
    if (linkEl) {
      listing.listing_url = await linkEl.evaluate(el => el.href);
      // Extract listing ID from URL
      const idMatch = listing.listing_url.match(/id-([a-zA-Z0-9]+)|\/(\d{6,})/);
      if (idMatch) {
        listing.listing_id = `sothebys-${idMatch[1] || idMatch[2]}`;
      }
    }

    // Extract beds/baths/sqft from details
    const detailsText = await card.evaluate(el => el.textContent);

    const bedMatch = detailsText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
    const bathMatch = detailsText.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba|bathroom)/i);
    const sqftMatch = detailsText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|sf)/i);

    if (bedMatch) listing.bedrooms = parseInt(bedMatch[1], 10);
    if (bathMatch) listing.bathrooms = parseFloat(bathMatch[1]);
    if (sqftMatch) listing.sqft = parseInt(sqftMatch[1].replace(',', ''), 10);

    // Generate ID if not found
    if (!listing.listing_id) {
      listing.listing_id = `sothebys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    return listing;

  } catch (error) {
    console.error("[Sotheby's] Error parsing listing card:", error.message);
    return null;
  }
}

/**
 * Scrape a single search results page
 */
async function scrapeSearchPage(page, url, verbose = false) {
  const listings = [];

  try {
    if (verbose) console.log(`[Sotheby's] Navigating to ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(3000, 5000);

    // Sotheby's may have dynamic loading - scroll to trigger
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 1000));
      }
      window.scrollTo(0, 0);
    });

    await randomDelay(2000, 3000);

    // Multiple possible card selectors for Sotheby's
    const cardSelectors = [
      '.listing-card',
      '.property-card',
      '[class*="ListingCard"]',
      '[class*="PropertyCard"]',
      '.search-result-item',
      '[data-testid="listing-card"]',
      'article[class*="listing"]',
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      cards = await page.$$(selector);
      if (cards.length > 0) {
        if (verbose) console.log(`[Sotheby's] Found ${cards.length} cards using selector: ${selector}`);
        break;
      }
    }

    if (cards.length === 0) {
      if (verbose) console.log(`[Sotheby's] No listing cards found on ${url}`);
      return listings;
    }

    for (const card of cards) {
      const listing = await parseListingCard(card, page);
      if (listing && listing.agent_name && listing.price > 0) {
        listings.push(listing);
      }
    }

    // Look for "Load More" or pagination
    const loadMoreSelectors = [
      'button[class*="load-more"]',
      'a[class*="load-more"]',
      '[class*="LoadMore"]',
      '.pagination a.next',
    ];

    for (const selector of loadMoreSelectors) {
      const loadMore = await page.$(selector);
      if (loadMore && listings.length < 40) {
        try {
          await loadMore.click();
          await randomDelay(3000, 5000);

          // Rescrape after loading more
          const newCards = await page.$$('[class*="listing"], [class*="property"], article');
          for (const card of newCards) {
            const listing = await parseListingCard(card, page);
            if (listing && listing.agent_name && listing.price > 0) {
              // Check for duplicates
              if (!listings.find(l => l.listing_id === listing.listing_id)) {
                listings.push(listing);
              }
            }
          }
        } catch (e) {
          // Load more failed, continue with what we have
        }
        break;
      }
    }

  } catch (error) {
    if (verbose) console.log(`[Sotheby's] Page scrape error for ${url}: ${error.message}`);
  }

  return listings;
}

/**
 * Main scraper function
 */
export async function scrapeSothebysListings(options = {}) {
  const {
    maxListings = 400,
    searchUrls = SOTHEBYS_SEARCH_URLS,
    verbose = false,
    headless = true,
  } = options;

  if (verbose) console.log(`[Sotheby's] Starting scrape for ${searchUrls.length} areas...`);

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

    // Block unnecessary resources for faster scraping
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

      if (verbose) console.log(`[Sotheby's] Total listings so far: ${allListings.length}`);

      // Delay between cities
      await randomDelay(4000, 7000);
    }

    await browser.close();

    return {
      success: true,
      source: 'sothebys',
      listings: allListings.slice(0, maxListings),
      count: Math.min(allListings.length, maxListings),
      scraped_at: new Date().toISOString(),
    };

  } catch (error) {
    if (browser) await browser.close();
    console.error(`[Sotheby's] Scraping error: ${error.message}`);

    return {
      success: false,
      source: 'sothebys',
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
  console.log("[Sotheby's] Starting Northern California listings scrape...");

  const result = await scrapeSothebysListings({
    verbose: true,
    headless: true,
  });

  if (result.success) {
    const outputPath = join(__dirname, `../../../data/2listings/sothebys-listings-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[Sotheby's] Saved ${result.count} listings to ${outputPath}`);
  } else {
    console.error(`[Sotheby's] Scrape failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
