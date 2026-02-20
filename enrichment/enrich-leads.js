#!/usr/bin/env node
/**
 * Master Lead Enrichment Pipeline
 *
 * Single command to process Clay exports through the full enrichment pipeline:
 * 1. Validate Clay export format
 * 2. Run LinkedIn enrichment
 * 3. Run Instagram enrichment
 * 4. Calculate ICP scores + generate hooks
 * 5. Generate segments for campaigns
 * 6. Output summary report
 *
 * Usage:
 *   node enrich-leads.js --input sf-bay-feb-2026.csv --region "SF Bay"
 *   node enrich-leads.js --input sf-bay-feb-2026.csv --test  # Process 10 leads only
 */

import { ApifyClient } from 'apify-client';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../.env') });

// ============================================================================
// CONFIGURATION
// ============================================================================

const REQUIRED_COLUMNS = ['First Name', 'Last Name', 'LinkedIn Profile'];
const EMAIL_COLUMNS = ['Email', 'Work Email'];
const OPTIONAL_COLUMNS = ['Company Name', 'IG handle'];

const LINKEDIN_ACTOR = 'harvestapi/linkedin-profile-posts';
const INSTAGRAM_ACTOR = 'sones/instagram-posts-scraper-lowcost';

// ============================================================================
// UTILITIES
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    region: 'Unknown',
    test: false,
    limit: null,
    skipLinkedIn: false,
    skipInstagram: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input': case '-i': options.input = args[++i]; break;
      case '--region': case '-r': options.region = args[++i]; break;
      case '--test': case '-t': options.test = true; options.limit = 10; break;
      case '--limit': case '-l': options.limit = parseInt(args[++i], 10); break;
      case '--skip-linkedin': options.skipLinkedIn = true; break;
      case '--skip-instagram': options.skipInstagram = true; break;
      case '--help': case '-h': printUsage(); process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Lead Enrichment Pipeline

Usage:
  node enrich-leads.js --input <file.csv> [options]

Options:
  -i, --input <file>     Input CSV file (required)
  -r, --region <name>    Region name for reporting
  -t, --test             Test mode (10 leads only)
  -l, --limit <n>        Process only first n leads
  --skip-linkedin        Skip LinkedIn enrichment
  --skip-instagram       Skip Instagram enrichment
  -h, --help             Show this help

Examples:
  node enrich-leads.js -i ../data/1raw/sf-bay-feb-2026.csv -r "SF Bay"
  node enrich-leads.js -i ../data/1raw/sf-bay-feb-2026.csv --test
  `);
}

function log(msg, level = 'info') {
  const colors = {
    info: '\x1b[36m',
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    step: '\x1b[35m',
  };
  console.log(`${colors[level] || ''}[${level.toUpperCase()}]\x1b[0m ${msg}`);
}

function extractLinkedInUsername(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

function extractInstagramUsername(handle) {
  if (!handle) return null;
  let username = handle.trim();
  if (username.startsWith('@')) username = username.slice(1);
  const urlMatch = username.match(/instagram\.com\/([^\/\?]+)/i);
  if (urlMatch) username = urlMatch[1];
  if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(username.toLowerCase())) {
    return null;
  }
  return username || null;
}

function normalizeLeads(leads) {
  return leads.map(lead => {
    const normalized = { ...lead };
    if (!normalized['Email'] && normalized['Work Email']) {
      normalized['Email'] = normalized['Work Email'];
    }
    return normalized;
  });
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateClayExport(leads) {
  const errors = [];
  const warnings = [];
  const columns = Object.keys(leads[0] || {});

  for (const col of REQUIRED_COLUMNS) {
    if (!columns.includes(col)) {
      errors.push(`Missing required column: "${col}"`);
    }
  }

  const hasEmailColumn = EMAIL_COLUMNS.some(col => columns.includes(col));
  if (!hasEmailColumn) {
    errors.push(`Missing email column: need one of ${EMAIL_COLUMNS.map(c => `"${c}"`).join(' or ')}`);
  }

  for (const col of OPTIONAL_COLUMNS) {
    if (!columns.includes(col)) {
      warnings.push(`Missing optional column: "${col}"`);
    }
  }

  let validLinkedIn = 0, validInstagram = 0, validEmail = 0;

  for (const lead of leads) {
    if (extractLinkedInUsername(lead['LinkedIn Profile'])) validLinkedIn++;
    if (extractInstagramUsername(lead['IG handle'])) validInstagram++;
    if (lead['Email'] && lead['Email'].includes('@')) validEmail++;
  }

  return {
    errors,
    warnings,
    stats: {
      total: leads.length,
      validLinkedIn,
      validInstagram,
      validEmail,
      linkedinRate: ((validLinkedIn / leads.length) * 100).toFixed(1),
      instagramRate: ((validInstagram / leads.length) * 100).toFixed(1),
      emailRate: ((validEmail / leads.length) * 100).toFixed(1),
    },
  };
}

// ============================================================================
// LINKEDIN ENRICHMENT
// ============================================================================

async function enrichLinkedIn(client, leads) {
  const validLeads = leads.filter(l => extractLinkedInUsername(l['LinkedIn Profile']));
  if (validLeads.length === 0) {
    log('No valid LinkedIn URLs found', 'warn');
    return leads;
  }

  log(`Found ${validLeads.length} valid LinkedIn URLs`);

  const urls = validLeads.map(l => l['LinkedIn Profile']);

  const run = await client.actor(LINKEDIN_ACTOR).call(
    { urls, maxPosts: 5 },
    { waitForFinish: 300 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  log(`LinkedIn scrape status: ${run.status}`);
  log(`LinkedIn results: ${items.length} profiles returned`);

  const resultsByUrl = {};
  for (const item of items) {
    const url = item.profileUrl || item.url;
    if (url) resultsByUrl[url.toLowerCase()] = item;
  }

  return leads.map(lead => {
    const url = (lead['LinkedIn Profile'] || '').toLowerCase();
    const result = resultsByUrl[url];

    if (result) {
      const posts = result.posts || [];
      const headline = result.author?.info || result.headline || '';
      const recentTopic = classifyLinkedInTopic(posts[0]?.text || '');

      return {
        ...lead,
        linkedin_headline: headline,
        linkedin_posts_count: posts.length,
        linkedin_recent_topic: recentTopic,
        linkedin_last_post_date: posts[0]?.date || '',
        linkedin_days_since_post: calculateDaysSince(posts[0]?.date),
        linkedin_enriched: 'Yes',
        linkedin_enriched_at: new Date().toISOString(),
      };
    }

    return {
      ...lead,
      linkedin_enriched: 'No',
    };
  });
}

function classifyLinkedInTopic(text) {
  if (!text) return 'general';
  const lower = text.toLowerCase();
  if (/just listed|new listing|coming soon|for sale|open house/i.test(lower)) return 'listing';
  if (/sold|closed|congrat|happy buyer|happy seller|keys/i.test(lower)) return 'client_success';
  if (/market|rates|inventory|prices/i.test(lower)) return 'market_update';
  return 'general';
}

function calculateDaysSince(dateStr) {
  if (!dateStr) return 999;
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 999;
  }
}

function parseDays(value, fallback = 999) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ============================================================================
// INSTAGRAM ENRICHMENT
// ============================================================================

async function enrichInstagram(client, leads) {
  const validLeads = leads.filter(l => extractInstagramUsername(l['IG handle']));
  if (validLeads.length === 0) {
    log('No valid Instagram handles found', 'warn');
    return leads;
  }

  log(`Found ${validLeads.length} valid Instagram handles`);

  const usernames = validLeads.map(l => extractInstagramUsername(l['IG handle']));

  const run = await client.actor(INSTAGRAM_ACTOR).call(
    { usernames, resultsLimit: 10 },
    { waitForFinish: 600 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  log(`Instagram scrape status: ${run.status}`);
  log(`Instagram results: ${items.length} posts returned`);

  const postsByUsername = {};
  for (const post of items) {
    const username = (post.ownerUsername || '').toLowerCase();
    if (!postsByUsername[username]) postsByUsername[username] = [];
    postsByUsername[username].push(post);
  }

  return leads.map(lead => {
    const username = (extractInstagramUsername(lead['IG handle']) || '').toLowerCase();
    const posts = postsByUsername[username] || [];

    if (posts.length > 0) {
      const listingPosts = posts.filter(p => isListingPost(p));
      const soldPosts = posts.filter(p => isSoldPost(p));
      const addresses = extractAddresses(posts);
      const neighborhoods = extractNeighborhoods(posts);
      const mostRecent = posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

      return {
        ...lead,
        ig_username: username,
        ig_followers: posts[0]?.ownerFollowerCount || 0,
        ig_posts_fetched: posts.length,
        ig_listing_posts_count: listingPosts.length,
        ig_sold_posts_count: soldPosts.length,
        ig_recent_addresses: addresses.join(' | '),
        ig_neighborhoods: neighborhoods.join(', '),
        ig_last_post_date: mostRecent?.timestamp || '',
        ig_days_since_post: calculateDaysSince(mostRecent?.timestamp),
        ig_days_since_listing: listingPosts[0] ? calculateDaysSince(listingPosts[0].timestamp) : 999,
        ig_enriched: 'Yes',
        ig_enriched_at: new Date().toISOString(),
      };
    }

    return {
      ...lead,
      ig_enriched: 'No',
    };
  });
}

function isListingPost(post) {
  const text = (post.caption || '').toLowerCase();
  return /just listed|new listing|for sale|open house|coming soon|price reduced/i.test(text);
}

function isSoldPost(post) {
  const text = (post.caption || '').toLowerCase();
  return /sold|closed|congrat|happy buyer|happy seller|keys|pending|under contract/i.test(text);
}

function extractAddresses(posts) {
  const addresses = [];
  const pattern = /(\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl))/gi;

  for (const post of posts) {
    const text = post.caption || '';
    const matches = text.match(pattern) || [];
    addresses.push(...matches.map(a => a.trim()));
  }

  return [...new Set(addresses)].slice(0, 3);
}

function extractNeighborhoods(posts) {
  const sfNeighborhoods = [
    'Pacific Heights', 'Marina', 'Noe Valley', 'Castro', 'Mission',
    'SOMA', 'SoMa', 'Russian Hill', 'North Beach', 'Hayes Valley',
    'Potrero Hill', 'Bernal Heights', 'Sunset', 'Richmond', 'Cole Valley',
    'Haight', 'Nob Hill', 'Dogpatch', 'Glen Park', 'Twin Peaks',
    'Oakland', 'Berkeley', 'Walnut Creek', 'Palo Alto', 'San Jose',
    'Marin', 'Tiburon', 'Saratoga', 'Cupertino', 'Menlo Park'
  ];

  const found = new Set();
  for (const post of posts) {
    const text = `${post.caption || ''} ${post.locationName || ''}`.toLowerCase();
    for (const hood of sfNeighborhoods) {
      if (text.includes(hood.toLowerCase())) {
        found.add(hood);
      }
    }
  }

  return [...found].slice(0, 3);
}

// ============================================================================
// ICP SCORING
// ============================================================================

function calculateIcpScore(lead) {
  let score = 50;
  const breakdown = ['+50: Clay baseline'];

  // LinkedIn Activity (Max +15)
  let linkedinPoints = 0;
  if (lead.linkedin_enriched === 'Yes') {
    linkedinPoints += 5;
    breakdown.push('+5: LinkedIn enriched');

    if ((parseInt(lead.linkedin_posts_count, 10) || 0) >= 3) {
      linkedinPoints += 5;
      breakdown.push('+5: LinkedIn 3+ posts');
    }

    const headline = (lead.linkedin_headline || '').toLowerCase();
    if (/luxury|top|team|lead|broker|#1|million/i.test(headline)) {
      linkedinPoints += 5;
      breakdown.push('+5: LinkedIn specialty headline');
    }
  }
  score += Math.min(linkedinPoints, 15);

  // Instagram Activity (Max +15)
  let instagramPoints = 0;
  if (lead.ig_enriched === 'Yes') {
    instagramPoints += 5;
    breakdown.push('+5: Instagram enriched');

    if ((parseInt(lead.ig_listing_posts_count, 10) || 0) >= 2) {
      instagramPoints += 5;
      breakdown.push('+5: IG 2+ listings');
    }

    if ((parseInt(lead.ig_followers, 10) || 0) >= 1000) {
      instagramPoints += 3;
      breakdown.push('+3: IG 1k+ followers');
    }

    if (lead.ig_recent_addresses) {
      instagramPoints += 2;
      breakdown.push('+2: IG address found');
    }
  }
  score += Math.min(instagramPoints, 15);

  // Transaction Urgency (Max +20)
  let urgencyPoints = 0;
  let transactionUrgency = 'None';
  const igDays = parseDays(lead.ig_days_since_listing, parseDays(lead.ig_days_since_post));
  const listingCount = parseInt(lead.ig_listing_posts_count, 10) || 0;
  const soldCount = parseInt(lead.ig_sold_posts_count, 10) || 0;

  if (igDays <= 7 && listingCount >= 1) {
    urgencyPoints += 10;
    transactionUrgency = 'High';
    breakdown.push('+10: Just listed (7 days)');
  }

  if (igDays <= 7 && soldCount >= 1) {
    urgencyPoints += 5;
    if (transactionUrgency !== 'High') transactionUrgency = 'Medium';
    breakdown.push('+5: Just sold (7 days)');
  }

  if (listingCount >= 2 || (listingCount >= 1 && soldCount >= 1)) {
    urgencyPoints += 5;
    if (transactionUrgency === 'None') transactionUrgency = 'Medium';
    breakdown.push('+5: Multiple transactions');
  }
  score += Math.min(urgencyPoints, 20);

  // Recency Bonus (Max +10, Min -10)
  const liDays = parseDays(lead.linkedin_days_since_post);
  const mostRecentDays = Math.min(igDays, liDays);
  let recencyBonus = 0;

  if (mostRecentDays <= 3) {
    recencyBonus = 10;
    breakdown.push('+10: Posted within 3 days');
  } else if (mostRecentDays <= 7) {
    recencyBonus = 7;
    breakdown.push('+7: Posted within 7 days');
  } else if (mostRecentDays <= 14) {
    recencyBonus = 5;
    breakdown.push('+5: Posted within 14 days');
  } else if (mostRecentDays <= 30) {
    recencyBonus = 2;
    breakdown.push('+2: Posted within 30 days');
  } else if (mostRecentDays > 90 && mostRecentDays < 999) {
    recencyBonus = -10;
    breakdown.push('-10: Inactive 90+ days');
  }
  score += recencyBonus;

  // Determine tier
  let tier;
  if (score >= 90) tier = 'Hot';
  else if (score >= 70) tier = 'High';
  else if (score >= 55) tier = 'Medium';
  else tier = 'Low';

  return { score, tier, breakdown: breakdown.join(' | '), transactionUrgency };
}

// ============================================================================
// HOOK GENERATION
// ============================================================================

function generateHook(lead) {
  const hooks = [];
  const company = (lead['Company Name'] || '').toLowerCase();

  function getRecencyBonus(daysAgo) {
    if (daysAgo === '' || daysAgo === undefined || daysAgo === null || daysAgo >= 999) return 0;
    const days = parseInt(daysAgo, 10);
    if (days <= 3) return 2.0;
    if (days <= 7) return 1.5;
    if (days <= 14) return 1.0;
    if (days <= 30) return 0.5;
    return 0;
  }

  const igDaysAgo = parseDays(lead.ig_days_since_listing, parseDays(lead.ig_days_since_post));
  const liDaysAgo = parseDays(lead.linkedin_days_since_post);
  const igRecency = getRecencyBonus(igDaysAgo);
  const liRecency = getRecencyBonus(liDaysAgo);

  // Instagram hooks
  if (lead.ig_enriched === 'Yes' && lead.ig_recent_addresses) {
    const firstAddress = lead.ig_recent_addresses.split('|')[0].trim();
    hooks.push({
      hook: `${firstAddress} probably came with 150+ pages of disclosures. How long did your buyers spend actually reading them?`,
      source: 'instagram_address',
      score: 8 + igRecency,
      daysAgo: igDaysAgo,
      recencyBonus: igRecency
    });
  }

  if (lead.ig_enriched === 'Yes' && lead.ig_neighborhoods && !lead.ig_recent_addresses) {
    const firstHood = lead.ig_neighborhoods.split(',')[0].trim();
    hooks.push({
      hook: `In ${firstHood}, buyers expect perfection. One missed disclosure item can blow up a $2M deal.`,
      source: 'instagram_neighborhood',
      score: 7 + igRecency,
      daysAgo: igDaysAgo,
      recencyBonus: igRecency
    });
  }

  if (lead.ig_enriched === 'Yes' && (parseInt(lead.ig_listing_posts_count, 10) || 0) >= 2) {
    hooks.push({
      hook: `Every hour you spend buried in disclosure docs is an hour you're not listing the next one.`,
      source: 'instagram_listing',
      score: 6 + igRecency,
      daysAgo: igDaysAgo,
      recencyBonus: igRecency
    });
  }

  if (lead.ig_enriched === 'Yes' && (parseInt(lead.ig_sold_posts_count, 10) || 0) >= 1) {
    hooks.push({
      hook: `The sold post gets the likes. The 4 hours reviewing disclosures beforehand? Nobody sees that.`,
      source: 'instagram_sold',
      score: 5 + igRecency,
      daysAgo: igDaysAgo,
      recencyBonus: igRecency
    });
  }

  // LinkedIn hooks
  if (lead.linkedin_enriched === 'Yes' && lead.linkedin_recent_topic === 'listing') {
    hooks.push({
      hook: `Behind every polished listing post is a 200-page disclosure packet someone had to review.`,
      source: 'linkedin_listing',
      score: 6 + liRecency,
      daysAgo: liDaysAgo,
      recencyBonus: liRecency
    });
  }

  if (lead.linkedin_enriched === 'Yes' && lead.linkedin_recent_topic === 'client_success') {
    hooks.push({
      hook: `You're closing deals. Which means you're reading hundreds of pages of disclosures every month.`,
      source: 'linkedin_sold',
      score: 5 + liRecency,
      daysAgo: liDaysAgo,
      recencyBonus: liRecency
    });
  }

  if (lead.linkedin_enriched === 'Yes') {
    const headline = (lead.linkedin_headline || '').toLowerCase();
    if (headline.includes('luxury')) {
      hooks.push({
        hook: `Luxury buyers ask harder questions. "I skimmed the disclosures" isn't an answer they accept.`,
        source: 'linkedin_headline',
        score: 2,
        daysAgo: null,
        recencyBonus: 0
      });
    } else if (headline.includes('team') || headline.includes('lead')) {
      hooks.push({
        hook: `Your agents close deals. Are they actually reading disclosures, or just hoping nothing blows up?`,
        source: 'linkedin_headline',
        score: 2,
        daysAgo: null,
        recencyBonus: 0
      });
    } else if (/top|#1|million/i.test(headline)) {
      hooks.push({
        hook: `Top producers close more deals. That also means more disclosure liability sitting on your desk.`,
        source: 'linkedin_headline',
        score: 2,
        daysAgo: null,
        recencyBonus: 0
      });
    }
  }

  // Company fallback
  const companyName = lead['Company Name'] || 'your brokerage';
  if (/compass|keller|kw|sotheby|coldwell|redfin|intero|vanguard|grubb/i.test(company)) {
    hooks.push({
      hook: `Some ${companyName} agents are reviewing disclosures in 5 minutes now. Figured you'd want to know.`,
      source: 'company',
      score: 1,
      daysAgo: null,
      recencyBonus: 0
    });
  }

  hooks.sort((a, b) => b.score - a.score);
  const winner = hooks[0] || { hook: '', source: 'none', score: 0, daysAgo: null, recencyBonus: 0 };

  return winner;
}

// ============================================================================
// SEGMENTS
// ============================================================================

function createSegments(leads, outputDir) {
  const segments = {
    'hot': leads.filter(l => l.icp_tier === 'Hot'),
    'high-icp': leads.filter(l => l.icp_tier === 'High'),
    'medium-icp': leads.filter(l => l.icp_tier === 'Medium'),
    'in-contract': leads.filter(l => l.transaction_urgency === 'High' || l.transaction_urgency === 'Medium'),
    'active-listers': leads.filter(l => (parseInt(l.ig_listing_posts_count, 10) || 0) >= 2),
    'recent-closers': leads.filter(l => (parseInt(l.ig_sold_posts_count, 10) || 0) >= 1),
    'high-followers': leads.filter(l => (parseInt(l.ig_followers, 10) || 0) >= 1000),
    'linkedin-active': leads.filter(l => (parseInt(l.linkedin_posts_count, 10) || 0) >= 3),
  };

  for (const [name, segmentLeads] of Object.entries(segments)) {
    if (segmentLeads.length > 0) {
      const filePath = join(outputDir, `segment-${name}.csv`);
      writeFileSync(filePath, stringify(segmentLeads, { header: true }));
      log(`Saved: segment-${name}.csv (${segmentLeads.length} leads)`, 'ok');
    }
  }

  return segments;
}

function createQaReport(leads) {
  const total = leads.length;
  const safePct = (count) => total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
  const invalidDaysSince = leads.filter(l => {
    const value = l.days_since_post;
    if (value === '' || value === null || value === undefined) return false;
    return Number.isNaN(parseInt(value, 10));
  }).length;
  const linkedinEnriched = leads.filter(l => l.linkedin_enriched === 'Yes').length;
  const instagramEnriched = leads.filter(l => l.ig_enriched === 'Yes').length;
  const withHook = leads.filter(l => Boolean(l.best_hook)).length;

  return {
    generated_at: new Date().toISOString(),
    total_leads: total,
    enrichment_coverage: {
      linkedin_yes: linkedinEnriched,
      instagram_yes: instagramEnriched,
      with_hook: withHook,
    },
    data_quality: {
      missing_email: leads.filter(l => !(l['Email'] || '').includes('@')).length,
      missing_linkedin_profile: leads.filter(l => !extractLinkedInUsername(l['LinkedIn Profile'])).length,
      missing_instagram_handle: leads.filter(l => !extractInstagramUsername(l['IG handle'])).length,
      invalid_days_since_post: invalidDaysSince,
      fallback_hooks: leads.filter(l => l.hook_source === 'company' || l.hook_source === 'none').length,
    },
    rates_pct: {
      linkedin_enriched: safePct(linkedinEnriched),
      instagram_enriched: safePct(instagramEnriched),
      with_hook: safePct(withHook),
    },
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const options = parseArgs();

  if (!options.input) {
    printUsage();
    process.exit(1);
  }

  console.log(`
╔═══════════════════════════════════════════════════╗
║       DISCLOSER LEAD ENRICHMENT PIPELINE          ║
╚═══════════════════════════════════════════════════╝
`);

  // Resolve input path
  let inputPath = options.input;
  if (!inputPath.startsWith('/')) {
    inputPath = join(process.cwd(), inputPath);
  }

  if (!existsSync(inputPath)) {
    log(`Input file not found: ${inputPath}`, 'error');
    process.exit(1);
  }

  const needsExternalEnrichment = !options.skipLinkedIn || !options.skipInstagram;
  if (needsExternalEnrichment && !process.env.APIFY_API_KEY) {
    log('APIFY_API_KEY not found in environment', 'error');
    process.exit(1);
  }

  const client = process.env.APIFY_API_KEY
    ? new ApifyClient({ token: process.env.APIFY_API_KEY })
    : null;

  // Load and validate
  log(`Loading Clay export from ${inputPath}...`);
  const content = readFileSync(inputPath, 'utf-8');
  let leads = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  leads = normalizeLeads(leads);

  log(`Loaded ${leads.length} leads`);

  const { errors, warnings, stats } = validateClayExport(leads);

  if (errors.length > 0) {
    log('Validation errors:', 'error');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  warnings.forEach(w => log(w, 'warn'));

  console.log(`
┌─────────────────────────────────────┐
│ INPUT VALIDATION                    │
├─────────────────────────────────────┤
│ Total leads:       ${String(stats.total).padStart(6)}          │
│ Valid LinkedIn:    ${String(stats.validLinkedIn).padStart(6)} (${stats.linkedinRate}%)  │
│ Valid Instagram:   ${String(stats.validInstagram).padStart(6)} (${stats.instagramRate}%)  │
│ Valid Email:       ${String(stats.validEmail).padStart(6)} (${stats.emailRate}%)  │
└─────────────────────────────────────┘
`);

  // Apply limit
  if (options.limit) {
    leads = leads.slice(0, options.limit);
    log(`Limited to ${leads.length} leads ${options.test ? '(test mode)' : ''}`);
  }

  // LinkedIn enrichment
  if (!options.skipLinkedIn) {
    log('Starting LinkedIn enrichment...', 'step');
    leads = await enrichLinkedIn(client, leads);
  }

  // Instagram enrichment
  if (!options.skipInstagram) {
    log('Starting Instagram enrichment...', 'step');
    leads = await enrichInstagram(client, leads);
  }

  // Calculate ICP scores and generate hooks
  log('Calculating ICP scores and generating hooks...', 'step');
  leads = leads.map(lead => {
    const { score, tier, breakdown, transactionUrgency } = calculateIcpScore(lead);
    const hookResult = generateHook(lead);

    const igDays = parseDays(lead.ig_days_since_post);
    const liDays = parseDays(lead.linkedin_days_since_post);
    const daysSincePost = Math.min(igDays, liDays);

    return {
      ...lead,
      icp_score: score,
      icp_tier: tier,
      icp_breakdown: breakdown,
      transaction_urgency: transactionUrgency,
      days_since_post: daysSincePost < 999 ? daysSincePost : '',
      best_hook: hookResult.hook,
      hook_source: hookResult.source,
      hook_score: hookResult.score,
      hook_days_ago: hookResult.daysAgo || '',
      hook_recency_bonus: hookResult.recencyBonus,
    };
  });

  // Sort by ICP score
  leads.sort((a, b) => b.icp_score - a.icp_score);

  // Create output directory
  const inputBasename = basename(inputPath, '.csv');
  const inputDir = dirname(inputPath);
  const outputBaseDir = inputDir.includes('/data/1raw')
    ? inputDir.replace('/data/1raw', '/data/3operational')
    : join(inputDir, '..', '3operational');
  const outputDir = join(outputBaseDir, inputBasename);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Save full enriched file
  const outputPath = join(outputDir, 'enriched-full.csv');
  writeFileSync(outputPath, stringify(leads, { header: true }));
  log(`Saved: ${outputPath}`, 'ok');

  // Create segments
  const segments = createSegments(leads, outputDir);

  // Summary stats
  const enrichedLinkedIn = leads.filter(l => l.linkedin_enriched === 'Yes').length;
  const enrichedInstagram = leads.filter(l => l.ig_enriched === 'Yes').length;
  const withHooks = leads.filter(l => l.best_hook).length;
  const hotIcp = leads.filter(l => l.icp_tier === 'Hot').length;
  const highIcp = leads.filter(l => l.icp_tier === 'High').length;
  const mediumIcp = leads.filter(l => l.icp_tier === 'Medium').length;
  const lowIcp = leads.filter(l => l.icp_tier === 'Low').length;
  const withUrgency = leads.filter(l => l.transaction_urgency === 'High' || l.transaction_urgency === 'Medium').length;

  // Save summary
  const summaryPath = join(outputDir, 'summary.txt');
  const summary = `
DISCLOSER LEAD ENRICHMENT SUMMARY
=================================
Region: ${options.region}
Date: ${new Date().toISOString().split('T')[0]}
Input: ${options.input}

ENRICHMENT RESULTS
------------------
Total Leads Processed: ${leads.length}
LinkedIn Enriched: ${enrichedLinkedIn} (${((enrichedLinkedIn/leads.length)*100).toFixed(1)}%)
Instagram Enriched: ${enrichedInstagram} (${((enrichedInstagram/leads.length)*100).toFixed(1)}%)
With Personalization Hooks: ${withHooks} (${((withHooks/leads.length)*100).toFixed(1)}%)
With Transaction Urgency: ${withUrgency} (${((withUrgency/leads.length)*100).toFixed(1)}%)

ICP TIERS (Max: 110)
--------------------
Hot (90+):     ${hotIcp} leads
High (70-89):  ${highIcp} leads
Medium (55-69): ${mediumIcp} leads
Low (<55):     ${lowIcp} leads

SEGMENTS CREATED
----------------
${Object.entries(segments).map(([name, s]) => `- ${name}: ${s.length} leads`).join('\n')}

TOP 10 LEADS BY ICP SCORE
-------------------------
${leads.slice(0, 10).map((l, i) =>
  `${i + 1}. ${l['First Name']} ${l['Last Name']} (${l.icp_score}) - ${l.icp_tier} - ${l.transaction_urgency || 'None'} - ${l['Company Name'] || 'N/A'}`
).join('\n')}

OUTPUT FILES
------------
${outputPath}
${Object.keys(segments).map(name => join(outputDir, `segment-${name}.csv`)).join('\n')}
  `;

  writeFileSync(summaryPath, summary);
  const qaReportPath = join(outputDir, 'qa-report.json');
  const qaReport = createQaReport(leads);
  writeFileSync(qaReportPath, JSON.stringify(qaReport, null, 2));

  console.log(`
╔═══════════════════════════════════════════════════╗
║           ENRICHMENT COMPLETE                     ║
╠═══════════════════════════════════════════════════╣
║  Total Processed:       ${String(leads.length).padStart(6)}                    ║
║  LinkedIn Enriched:     ${String(enrichedLinkedIn).padStart(6)} (${((enrichedLinkedIn/leads.length)*100).toFixed(0)}%)              ║
║  Instagram Enriched:    ${String(enrichedInstagram).padStart(6)} (${((enrichedInstagram/leads.length)*100).toFixed(0)}%)              ║
║  With Hooks:            ${String(withHooks).padStart(6)} (${((withHooks/leads.length)*100).toFixed(0)}%)              ║
║  Transaction Urgency:   ${String(withUrgency).padStart(6)} (${((withUrgency/leads.length)*100).toFixed(0)}%)              ║
╠═══════════════════════════════════════════════════╣
║  ICP BREAKDOWN (Max 110)                          ║
║  Hot: ${String(hotIcp).padStart(4)}  High: ${String(highIcp).padStart(4)}  Med: ${String(mediumIcp).padStart(4)}  Low: ${String(lowIcp).padStart(4)}    ║
╠═══════════════════════════════════════════════════╣
  ║  Output: ${outputDir.slice(-40).padEnd(40)} ║
  ╚═══════════════════════════════════════════════════╝
`);

  log(`Summary saved to ${summaryPath}`, 'ok');
  log(`QA report saved to ${qaReportPath}`, 'ok');
}

main().catch(err => {
  log(err.message, 'error');
  console.error(err);
  process.exit(1);
});
