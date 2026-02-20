#!/usr/bin/env node

/**
 * LinkedIn Enricher (Standalone)
 *
 * Enriches leads with LinkedIn profile data using Apify's harvestapi/linkedin-profile-posts actor.
 * Cost: ~$2 per 1,000 results
 *
 * Usage:
 *   npm run enrich:linkedin -- -i data/1raw/leads.csv -o data/2enriched/linkedin-enriched.csv
 *   npm run enrich:linkedin -- -i data/1raw/leads.csv --limit 10
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
const LINKEDIN_ACTOR = 'harvestapi/linkedin-profile-posts';

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
  console.error('Usage: npm run enrich:linkedin -- -i <input.csv> [-o <output.csv>] [--limit N]');
  process.exit(1);
}

// ============================================================================
// LINKEDIN ENRICHMENT
// ============================================================================

function extractLinkedInUsername(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

async function enrichLinkedIn(leads) {
  const client = new ApifyClient({ token: APIFY_API_KEY });

  // Extract valid LinkedIn URLs
  const profileUrls = leads
    .map(lead => lead['LinkedIn Profile'] || lead.linkedin_url)
    .filter(url => url && extractLinkedInUsername(url));

  if (profileUrls.length === 0) {
    console.log('No valid LinkedIn URLs found');
    return new Map();
  }

  console.log(`Enriching ${profileUrls.length} LinkedIn profiles...`);

  const input = {
    profileUrls: profileUrls,
    maxPosts: 5,
    minDelay: 2,
    maxDelay: 5
  };

  try {
    const run = await client.actor(LINKEDIN_ACTOR).call(input, {
      waitSecs: 300
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`Retrieved ${items.length} LinkedIn profiles`);

    // Create lookup map by username
    const resultsMap = new Map();
    for (const item of items) {
      const username = extractLinkedInUsername(item.url || item.profileUrl);
      if (username) {
        resultsMap.set(username.toLowerCase(), item);
      }
    }

    return resultsMap;
  } catch (error) {
    console.error('LinkedIn enrichment failed:', error.message);
    return new Map();
  }
}

function processLinkedInData(lead, linkedInData) {
  if (!linkedInData) {
    return {
      linkedin_enriched: 'No',
      linkedin_headline: '',
      linkedin_posts_count: 0,
      linkedin_recent_topic: '',
      linkedin_engagement_avg: 0
    };
  }

  const headline = linkedInData.author?.info || linkedInData.headline || '';
  const posts = linkedInData.posts || [];

  // Extract recent topic from posts
  let recentTopic = '';
  if (posts.length > 0) {
    const firstPost = posts[0].text || posts[0].content || '';
    if (firstPost.toLowerCase().includes('listing')) recentTopic = 'listing';
    else if (firstPost.toLowerCase().includes('sold')) recentTopic = 'sold';
    else if (firstPost.toLowerCase().includes('market')) recentTopic = 'market update';
    else if (firstPost.toLowerCase().includes('close')) recentTopic = 'closing';
  }

  // Calculate average engagement
  const totalEngagement = posts.reduce((sum, post) => {
    return sum + (post.likes || 0) + (post.comments || 0);
  }, 0);
  const avgEngagement = posts.length > 0 ? Math.round(totalEngagement / posts.length) : 0;

  return {
    linkedin_enriched: 'Yes',
    linkedin_headline: headline,
    linkedin_posts_count: posts.length,
    linkedin_recent_topic: recentTopic,
    linkedin_engagement_avg: avgEngagement
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LINKEDIN ENRICHER');
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
  const linkedInResults = await enrichLinkedIn(leads);

  // Merge results
  let enrichedCount = 0;
  for (const lead of leads) {
    const url = lead['LinkedIn Profile'] || lead.linkedin_url;
    const username = extractLinkedInUsername(url);

    if (username && linkedInResults.has(username.toLowerCase())) {
      const data = linkedInResults.get(username.toLowerCase());
      const processed = processLinkedInData(lead, data);
      Object.assign(lead, processed);
      enrichedCount++;
    } else {
      Object.assign(lead, processLinkedInData(lead, null));
    }
  }

  // Output
  const outputPath = outputFile
    ? path.resolve(outputFile)
    : inputPath.replace('.csv', '-linkedin.csv');

  const output = stringify(leads, { header: true });
  fs.writeFileSync(outputPath, output);

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  LINKEDIN ENRICHMENT COMPLETE`);
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
