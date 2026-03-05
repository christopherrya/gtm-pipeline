#!/usr/bin/env node

/**
 * Benchmark Apify Actors — Test 7 LinkedIn + 7 Instagram scrapers
 *
 * Runs each actor against 10 sample records, measures speed, data quality,
 * fields returned, and cost. Outputs a comparison report.
 *
 * Usage:
 *   node scripts/benchmark-actors.js [--linkedin-only] [--instagram-only] [--verbose]
 */

import { ApifyClient } from 'apify-client';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const APIFY_API_KEY = process.env.APIFY_API_KEY;
if (!APIFY_API_KEY) {
  console.error('Error: APIFY_API_KEY not set in .env');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_API_KEY });

const args = process.argv.slice(2);
const linkedinOnly = args.includes('--linkedin-only');
const instagramOnly = args.includes('--instagram-only');
const verbose = args.includes('--verbose');

// ---------------------------------------------------------------------------
// Sample data — 10 SF Bay real estate agents from clay_sf_500.csv
// ---------------------------------------------------------------------------

const SAMPLE_LINKEDIN_URLS = [
  'https://www.linkedin.com/in/juliesinner/',
  'https://www.linkedin.com/in/maryloucastellanos/',
  'https://www.linkedin.com/in/michaeltessarorealtor/',
  'https://www.linkedin.com/in/bryan-martin-1278463/',
  'https://www.linkedin.com/in/johnnickporcuna/',
  'https://www.linkedin.com/in/callstephanielebeaurealtor/',
  'https://www.linkedin.com/in/andreas-mokos-215a2448/',
  'https://www.linkedin.com/in/mike-plotkowski-bba0402/',
  'https://www.linkedin.com/in/aj-scott-4712b6133/',
  'https://www.linkedin.com/in/hanhuy/',
];

const SAMPLE_IG_HANDLES = [
  'juliesinnerllc',
  'marylou.castellanos',
  'michaeltessarorealtor',
  'bhinesmartin',
  'john_nick',
  'stephanielebeausfrealtor',
  'andreas_mokos',
  'plotkowskimike',
  'ajscott_realestate',
  'huyestate',
];

// ---------------------------------------------------------------------------
// Actor definitions
// ---------------------------------------------------------------------------

const LINKEDIN_ACTORS = [
  {
    id: 'harvestapi/linkedin-profile-posts',
    name: 'HarvestAPI Profile+Posts',
    note: 'Current enricher. $2/1k, no cookies.',
    buildInput: (urls) => ({ profileUrls: urls, maxPosts: 5 }),
    extractProfile: (item) => ({
      name: item.author?.name || item.fullName || '',
      headline: item.author?.info || item.headline || '',
      posts: (item.posts || []).length,
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'dev_fusion/linkedin-profile-scraper',
    name: 'DevFusion Profile+Email',
    note: '38k users. Built-in email discovery.',
    buildInput: (urls) => ({ profileUrls: urls, getEmails: true }),
    extractProfile: (item) => ({
      name: item.fullName || item.name || '',
      headline: item.headline || '',
      email: item.email || item.workEmail || '',
      experience: (item.experience || item.positions || []).length,
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'curious_coder/linkedin-profile-scraper',
    name: 'CuriousCoder Profile',
    note: '5.4k users. Accepts search URLs.',
    buildInput: (urls) => ({ urls: urls, maxResults: 10 }),
    extractProfile: (item) => ({
      name: item.fullName || item.name || '',
      headline: item.headline || item.title || '',
      location: item.location || '',
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'apimaestro/linkedin-profile-posts',
    name: 'APIMaestro Profile Posts',
    note: 'Focused on post data extraction.',
    buildInput: (urls) => ({ profileUrls: urls, maxPosts: 5 }),
    extractProfile: (item) => ({
      name: item.author?.name || item.fullName || '',
      headline: item.author?.info || item.headline || '',
      posts: (item.posts || []).length,
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'scraper-engine/linkedin-profile-and-company-posts-scraper',
    name: 'ScraperEngine Profile+Company',
    note: 'All-in-one profile and company posts.',
    buildInput: (urls) => ({ profileUrls: urls, maxPosts: 5 }),
    extractProfile: (item) => ({
      name: item.author?.name || item.fullName || '',
      headline: item.headline || '',
      posts: (item.posts || []).length,
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'get-leads/linkedin-scraper',
    name: 'GetLeads All-in-One',
    note: 'Comprehensive LinkedIn scraper.',
    buildInput: (urls) => ({ profileUrls: urls }),
    extractProfile: (item) => ({
      name: item.fullName || item.name || '',
      headline: item.headline || '',
      connections: item.connections || item.connectionCount || 0,
      url: item.profileUrl || item.url || '',
    }),
  },
  {
    id: 'ahmed-khaled/linkedin-engagement-scraper',
    name: 'AhmedKhaled Engagement',
    note: 'Profile + engagement metrics.',
    buildInput: (urls) => ({ profileUrls: urls, maxPosts: 5 }),
    extractProfile: (item) => ({
      name: item.author?.name || item.fullName || '',
      headline: item.headline || '',
      engagement: item.totalEngagement || item.avgEngagement || 0,
      posts: (item.posts || []).length,
      url: item.profileUrl || item.url || '',
    }),
  },
];

const INSTAGRAM_ACTORS = [
  {
    id: 'sones/instagram-posts-scraper-lowcost',
    name: 'Sones LowCost Posts',
    note: 'Current enricher. ~$0.25/1k.',
    buildInput: (handles) => ({ usernames: handles, resultsLimit: 5 }),
    extractPost: (item) => ({
      username: item.ownerUsername || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || item.likes || 0,
      comments: item.commentsCount || item.comments || 0,
      timestamp: item.timestamp || '',
      followers: item.ownerFollowerCount || 0,
    }),
  },
  {
    id: 'apify/instagram-scraper',
    name: 'Apify Official Scraper',
    note: '179k users. Universal profiles+posts+hashtags.',
    buildInput: (handles) => ({
      directUrls: handles.map(h => `https://www.instagram.com/${h}/`),
      resultsType: 'posts',
      resultsLimit: 5,
    }),
    extractPost: (item) => ({
      username: item.ownerUsername || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      timestamp: item.timestamp || '',
    }),
  },
  {
    id: 'apify/instagram-post-scraper',
    name: 'Apify Post Scraper',
    note: '67k users. Content-focused.',
    buildInput: (handles) => ({
      usernames: handles,
      resultsLimit: 5,
    }),
    extractPost: (item) => ({
      username: item.ownerUsername || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      timestamp: item.timestamp || '',
    }),
  },
  {
    id: 'apify/instagram-profile-scraper',
    name: 'Apify Profile Scraper',
    note: '86k users. Profile metadata only (fast).',
    buildInput: (handles) => ({
      usernames: handles,
    }),
    extractPost: (item) => ({
      username: item.username || '',
      fullName: item.fullName || '',
      biography: (item.biography || '').slice(0, 80),
      followers: item.followersCount || 0,
      following: item.followsCount || 0,
      postsCount: item.postsCount || 0,
      isVerified: item.verified || false,
      externalUrl: item.externalUrl || '',
    }),
  },
  {
    id: 'apidojo/instagram-scraper',
    name: 'APIDojo Pay-Per-Result',
    note: 'Pay per result. $0.50/1k posts.',
    buildInput: (handles) => ({
      usernames: handles,
      resultsLimit: 5,
    }),
    extractPost: (item) => ({
      username: item.ownerUsername || item.username || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      timestamp: item.timestamp || '',
    }),
  },
  {
    id: 'apify/instagram-api-scraper',
    name: 'Apify API Scraper',
    note: 'API-based extraction.',
    buildInput: (handles) => ({
      usernames: handles,
      resultsLimit: 5,
      resultsType: 'posts',
    }),
    extractPost: (item) => ({
      username: item.ownerUsername || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      timestamp: item.timestamp || '',
    }),
  },
  {
    id: 'singhera07/instagram-scraper',
    name: 'Singhera Universal',
    note: 'Profiles, posts, reels, stories.',
    buildInput: (handles) => ({
      usernames: handles,
      scrapeType: 'posts',
      resultsLimit: 5,
    }),
    extractPost: (item) => ({
      username: item.ownerUsername || item.username || '',
      caption: (item.caption || '').slice(0, 80),
      likes: item.likesCount || item.likes || 0,
      comments: item.commentsCount || item.comments || 0,
      timestamp: item.timestamp || '',
    }),
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runActor(actorDef, inputData, type) {
  const label = `[${type}] ${actorDef.name}`;
  console.log(`\n  ${label}`);
  console.log(`  Actor: ${actorDef.id}`);
  console.log(`  Note: ${actorDef.note}`);

  const input = actorDef.buildInput(inputData);
  const startTime = Date.now();

  const result = {
    actorId: actorDef.id,
    name: actorDef.name,
    note: actorDef.note,
    type,
    status: 'unknown',
    durationMs: 0,
    durationSec: 0,
    itemCount: 0,
    uniqueProfiles: 0,
    sampleFields: [],
    costUsd: null,
    error: null,
    rawItems: [],
    extractedSamples: [],
  };

  try {
    console.log(`  Starting actor...`);
    const run = await client.actor(actorDef.id).call(input, {
      waitSecs: 180, // 3 min timeout per actor
    });

    result.status = run.status;
    result.durationMs = Date.now() - startTime;
    result.durationSec = (result.durationMs / 1000).toFixed(1);

    // Get usage/cost info
    if (run.stats) {
      result.costUsd = run.stats.computeUnits
        ? `~$${(run.stats.computeUnits * 0.25).toFixed(4)}`
        : null;
    }
    if (run.usage) {
      const totalUsd = Object.values(run.usage).reduce((s, v) => s + (v.USD || 0), 0);
      if (totalUsd > 0) result.costUsd = `$${totalUsd.toFixed(4)}`;
    }

    // Fetch dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    result.itemCount = items.length;
    result.rawItems = items;

    console.log(`  Status: ${run.status} | Items: ${items.length} | Time: ${result.durationSec}s`);

    // Extract and analyze
    if (items.length > 0) {
      // Collect all unique top-level fields across all items
      const allFields = new Set();
      for (const item of items) {
        Object.keys(item).forEach(k => allFields.add(k));
      }
      result.sampleFields = [...allFields].sort();

      // Count unique profiles
      const profileSet = new Set();
      for (const item of items) {
        const key = type === 'LinkedIn'
          ? (item.profileUrl || item.url || item.author?.url || '').toLowerCase()
          : (item.ownerUsername || item.username || '').toLowerCase();
        if (key) profileSet.add(key);
      }
      result.uniqueProfiles = profileSet.size;

      // Extract samples using actor-specific extractor
      const extractor = type === 'LinkedIn' ? actorDef.extractProfile : actorDef.extractPost;
      result.extractedSamples = items.slice(0, 3).map(extractor);

      if (verbose) {
        console.log(`  Fields: ${result.sampleFields.join(', ')}`);
        console.log(`  Unique profiles: ${result.uniqueProfiles}/10`);
        console.log(`  Sample:`, JSON.stringify(result.extractedSamples[0], null, 2));
      }
    }
  } catch (err) {
    result.status = 'FAILED';
    result.error = err.message;
    result.durationMs = Date.now() - startTime;
    result.durationSec = (result.durationMs / 1000).toFixed(1);
    console.log(`  FAILED: ${err.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results, type) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${type.toUpperCase()} ACTOR BENCHMARK RESULTS (10 sample records)`);
  console.log(`${'═'.repeat(80)}`);

  // Sort by items returned (descending), then by speed
  const sorted = [...results].sort((a, b) => {
    if (a.status === 'FAILED' && b.status !== 'FAILED') return 1;
    if (b.status === 'FAILED' && a.status !== 'FAILED') return -1;
    if (b.uniqueProfiles !== a.uniqueProfiles) return b.uniqueProfiles - a.uniqueProfiles;
    return a.durationMs - b.durationMs;
  });

  console.log(`\n  ┌─────┬──────────────────────────────┬──────────┬────────┬──────────┬──────────────┐`);
  console.log(`  │ Rk  │ Actor                        │ Status   │ Items  │ Profiles │ Time         │`);
  console.log(`  ├─────┼──────────────────────────────┼──────────┼────────┼──────────┼──────────────┤`);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const rank = String(i + 1).padStart(2);
    const name = r.name.slice(0, 28).padEnd(28);
    const status = (r.status === 'SUCCEEDED' ? 'OK' : r.status === 'FAILED' ? 'FAIL' : r.status).padEnd(8);
    const items = String(r.itemCount).padStart(5);
    const profiles = `${r.uniqueProfiles}/10`.padStart(8);
    const time = `${r.durationSec}s`.padStart(10);
    console.log(`  │ ${rank}  │ ${name} │ ${status} │ ${items} │ ${profiles} │ ${time}   │`);
  }

  console.log(`  └─────┴──────────────────────────────┴──────────┴────────┴──────────┴──────────────┘`);

  // Detailed per-actor info
  for (const r of sorted) {
    console.log(`\n  --- ${r.name} (${r.actorId}) ---`);
    console.log(`  Status: ${r.status} | Items: ${r.itemCount} | Profiles: ${r.uniqueProfiles}/10 | Time: ${r.durationSec}s`);
    if (r.costUsd) console.log(`  Cost: ${r.costUsd}`);
    if (r.error) console.log(`  Error: ${r.error}`);
    if (r.sampleFields.length > 0) {
      console.log(`  Fields (${r.sampleFields.length}): ${r.sampleFields.slice(0, 20).join(', ')}${r.sampleFields.length > 20 ? '...' : ''}`);
    }
    if (r.extractedSamples.length > 0) {
      console.log(`  Sample: ${JSON.stringify(r.extractedSamples[0])}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  APIFY ACTOR BENCHMARK — LinkedIn & Instagram Scrapers     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Testing ${SAMPLE_LINKEDIN_URLS.length} LinkedIn profiles and ${SAMPLE_IG_HANDLES.length} Instagram handles`);

  const allResults = [];

  // LinkedIn actors
  if (!instagramOnly) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log('  LINKEDIN ACTORS (7)');
    console.log(`${'─'.repeat(80)}`);

    const linkedinResults = [];
    for (const actor of LINKEDIN_ACTORS) {
      const result = await runActor(actor, SAMPLE_LINKEDIN_URLS, 'LinkedIn');
      linkedinResults.push(result);
    }
    printReport(linkedinResults, 'LinkedIn');
    allResults.push(...linkedinResults);
  }

  // Instagram actors
  if (!linkedinOnly) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log('  INSTAGRAM ACTORS (7)');
    console.log(`${'─'.repeat(80)}`);

    const instagramResults = [];
    for (const actor of INSTAGRAM_ACTORS) {
      const result = await runActor(actor, SAMPLE_IG_HANDLES, 'Instagram');
      instagramResults.push(result);
    }
    printReport(instagramResults, 'Instagram');
    allResults.push(...instagramResults);
  }

  // Save full results to JSON
  const outputDir = join(__dirname, 'output');
  mkdirSync(outputDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outputPath = join(outputDir, `actor-benchmark_${date}.json`);

  // Strip rawItems for the saved file (too large)
  const savedResults = allResults.map(({ rawItems, ...rest }) => ({
    ...rest,
    rawItemSample: rawItems.slice(0, 2),
  }));
  writeFileSync(outputPath, JSON.stringify(savedResults, null, 2));
  console.log(`\n  Full results saved to: ${outputPath}`);

  // Final summary
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  BENCHMARK COMPLETE');
  console.log(`${'═'.repeat(80)}`);
  const succeeded = allResults.filter(r => r.status === 'SUCCEEDED').length;
  const failed = allResults.filter(r => r.status === 'FAILED').length;
  console.log(`  Tested: ${allResults.length} actors | Succeeded: ${succeeded} | Failed: ${failed}`);
  console.log(`  Total time: ${(allResults.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
