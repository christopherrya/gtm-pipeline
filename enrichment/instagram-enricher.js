#!/usr/bin/env node

/**
 * Instagram Enricher (Standalone)
 *
 * Enriches leads with Instagram post data using Apify's sones/instagram-posts-scraper-lowcost actor.
 * Cost: ~$0.25 per 1,000 results
 *
 * Usage:
 *   npm run enrich:instagram -- -i data/1raw/leads.csv -o data/2enriched/instagram-enriched.csv
 *   npm run enrich:instagram -- -i data/1raw/leads.csv --limit 10
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const INSTAGRAM_ACTOR = 'sones/instagram-posts-scraper-lowcost';

if (!APIFY_API_KEY) {
  console.error('Error: APIFY_API_KEY not found in .env file');
  process.exit(1);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const inputFile = getArg('-i') || getArg('--input');
const outputFile = getArg('-o') || getArg('--output');
const limit = parseInt(getArg('--limit')) || null;

if (!inputFile) {
  console.error('Usage: npm run enrich:instagram -- -i <input.csv> [-o <output.csv>] [--limit N]');
  process.exit(1);
}

// ============================================================================
// INSTAGRAM ENRICHMENT
// ============================================================================

function extractInstagramHandle(input) {
  if (!input) return null;

  // Remove @ prefix
  let handle = input.trim().replace(/^@/, '');

  // Extract from URL if provided
  const urlMatch = handle.match(/instagram\.com\/([^\/\?]+)/i);
  if (urlMatch) {
    handle = urlMatch[1];
  }

  // Validate handle
  if (handle && /^[a-zA-Z0-9._]+$/.test(handle)) {
    return handle;
  }

  return null;
}

async function enrichInstagram(leads) {
  const client = new ApifyClient({ token: APIFY_API_KEY });

  // Extract valid Instagram handles
  const handles = leads
    .map(lead => extractInstagramHandle(lead['IG handle'] || lead.ig_handle))
    .filter(Boolean);

  const uniqueHandles = [...new Set(handles)];

  if (uniqueHandles.length === 0) {
    console.log('No valid Instagram handles found');
    return new Map();
  }

  console.log(`Enriching ${uniqueHandles.length} Instagram profiles...`);

  const input = {
    usernames: uniqueHandles,
    resultsLimit: 5
  };

  try {
    const run = await client.actor(INSTAGRAM_ACTOR).call(input, {
      waitSecs: 300
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`Retrieved ${items.length} Instagram posts`);

    // Group posts by username
    const resultsMap = new Map();
    for (const item of items) {
      const username = (item.ownerUsername || '').toLowerCase();
      if (!username) continue;

      if (!resultsMap.has(username)) {
        resultsMap.set(username, []);
      }
      resultsMap.get(username).push(item);
    }

    return resultsMap;
  } catch (error) {
    console.error('Instagram enrichment failed:', error.message);
    return new Map();
  }
}

function processInstagramData(lead, posts) {
  if (!posts || posts.length === 0) {
    return {
      ig_enriched: 'No',
      ig_followers: 0,
      ig_posts_count: 0,
      ig_listing_posts_count: 0,
      ig_sold_posts_count: 0,
      ig_recent_addresses: '',
      ig_recent_neighborhoods: '',
      ig_most_recent_post_date: ''
    };
  }

  // Analyze posts
  let listingCount = 0;
  let soldCount = 0;
  const addresses = [];
  const neighborhoods = [];
  let mostRecentDate = null;

  for (const post of posts) {
    const caption = (post.caption || '').toLowerCase();
    const timestamp = post.timestamp ? new Date(post.timestamp) : null;

    // Track recency
    if (timestamp && (!mostRecentDate || timestamp > mostRecentDate)) {
      mostRecentDate = timestamp;
    }

    // Detect listing posts
    if (caption.includes('just listed') || caption.includes('new listing') ||
        caption.includes('for sale') || caption.includes('open house')) {
      listingCount++;
    }

    // Detect sold posts
    if (caption.includes('just sold') || caption.includes('sold!') ||
        caption.includes('closed escrow') || caption.includes('congrats to')) {
      soldCount++;
    }

    // Extract addresses (look for street numbers followed by street names)
    const addressMatch = caption.match(/\d+\s+[a-zA-Z]+\s+(st|street|ave|avenue|dr|drive|rd|road|ln|lane|way|blvd|boulevard|ct|court|pl|place)/gi);
    if (addressMatch) {
      addresses.push(...addressMatch.map(a => a.trim()));
    }

    // Extract neighborhoods from location data
    if (post.locationName) {
      neighborhoods.push(post.locationName);
    }
  }

  // Get follower count from first post's owner data
  const followers = posts[0]?.ownerFollowerCount || 0;

  return {
    ig_enriched: 'Yes',
    ig_followers: followers,
    ig_posts_count: posts.length,
    ig_listing_posts_count: listingCount,
    ig_sold_posts_count: soldCount,
    ig_recent_addresses: [...new Set(addresses)].slice(0, 3).join(', '),
    ig_recent_neighborhoods: [...new Set(neighborhoods)].slice(0, 3).join(', '),
    ig_most_recent_post_date: mostRecentDate ? mostRecentDate.toISOString().split('T')[0] : ''
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  INSTAGRAM ENRICHER');
  console.log('═══════════════════════════════════════════════════════════════');

  const inputPath = path.resolve(inputFile);

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\nReading: ${inputPath}`);

  const csvContent = fs.readFileSync(inputPath, 'utf-8');
  let leads = parse(csvContent, { columns: true, skip_empty_lines: true });

  if (limit && limit < leads.length) {
    console.log(`Limiting to ${limit} leads`);
    leads = leads.slice(0, limit);
  }

  console.log(`Processing ${leads.length} leads`);

  // Enrich
  const igResults = await enrichInstagram(leads);

  // Merge results
  let enrichedCount = 0;
  for (const lead of leads) {
    const handle = extractInstagramHandle(lead['IG handle'] || lead.ig_handle);

    if (handle && igResults.has(handle.toLowerCase())) {
      const posts = igResults.get(handle.toLowerCase());
      const processed = processInstagramData(lead, posts);
      Object.assign(lead, processed);
      enrichedCount++;
    } else {
      Object.assign(lead, processInstagramData(lead, null));
    }
  }

  // Output
  const outputPath = outputFile
    ? path.resolve(outputFile)
    : inputPath.replace('.csv', '-instagram.csv');

  const output = stringify(leads, { header: true });
  fs.writeFileSync(outputPath, output);

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  INSTAGRAM ENRICHMENT COMPLETE`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Total Leads: ${leads.length}`);
  console.log(`  Enriched:    ${enrichedCount} (${Math.round(enrichedCount / leads.length * 100)}%)`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
