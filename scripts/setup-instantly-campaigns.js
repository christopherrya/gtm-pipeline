#!/usr/bin/env node

/**
 * Setup Instantly Campaigns — Create campaigns via Instantly v2 API
 *
 * Creates campaigns with the correct naming convention, send schedule,
 * and sequence structure. Email copy is tier-specific and uses Instantly
 * merge variables for personalization.
 *
 * Campaign types:
 *   A/B first touch: 4 emails over 14 days (day 0, 3, 8, 13)
 *   C nurture:       2 emails over 7 days (day 0, 6)
 *   D soft followup: 1 email
 *
 * Usage:
 *   node scripts/setup-instantly-campaigns.js --tier hot --test subject_v1 [--dry-run]
 *   node scripts/setup-instantly-campaigns.js --tier hot --test subject_v1 --campaigns a,b
 *   node scripts/setup-instantly-campaigns.js --tier hot --campaigns c
 *   node scripts/setup-instantly-campaigns.js --tier hot --campaigns d
 *   node scripts/setup-instantly-campaigns.js --list
 */

import { getEnv, withRetry } from './lib/twenty-client.js';
import { buildCampaignLabel } from './lib/constants.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const tier = getArg('--tier');
const testName = getArg('--test');
const campaignTypes = (getArg('--campaigns') || 'a,b').split(',').map((s) => s.trim().toLowerCase());
const listOnly = hasFlag('--list');
const dryRun = hasFlag('--dry-run');
const timezone = getArg('--timezone') || 'America/Creston';
const startDate = getArg('--start-date') || new Date().toISOString().slice(0, 10);

if (!listOnly && !tier) {
  console.error('Usage:');
  console.error('  node scripts/setup-instantly-campaigns.js --tier hot --test subject_v1 [--campaigns a,b] [--dry-run]');
  console.error('  node scripts/setup-instantly-campaigns.js --list');
  console.error('');
  console.error('Options:');
  console.error('  --tier          ICP tier: hot, high, medium (required)');
  console.error('  --test          Test name: subject_v1, value_prop_v1 (required for A/B)');
  console.error('  --campaigns     Which to create: a,b | c | d | a,b,c,d (default: a,b)');
  console.error('  --timezone      Send timezone (default: America/Los_Angeles)');
  console.error('  --start-date    Campaign start date YYYY-MM-DD (default: today)');
  console.error('  --list          List existing Instantly campaigns');
  console.error('  --dry-run       Show what would be created without calling API');
  process.exit(1);
}

if (!listOnly && (campaignTypes.includes('a') || campaignTypes.includes('b')) && !testName) {
  console.error('Error: --test required for A/B campaigns (e.g. --test subject_v1)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Instantly v2 API client
// ---------------------------------------------------------------------------

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';

async function instantlyFetch(method, path, body) {
  const apiKey = getEnv('INSTANTLY_API_KEY') || getEnv('INSTANTLY_DISCLOSER_API_KEY');
  if (!apiKey) throw new Error('INSTANTLY_API_KEY not set in .env');

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const response = await fetch(`${INSTANTLY_BASE}${path}`, opts);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly API ${method} ${path}: ${response.status} ${text}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Schedule — Mon-Fri 9:00-11:00 AM
// ---------------------------------------------------------------------------

function buildSchedule() {
  return {
    start_date: startDate,
    schedules: [
      {
        name: 'Weekday Morning',
        timing: { from: '09:00', to: '11:00' },
        days: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        },
        timezone,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sequence copy — tier-specific, A/B subject lines
// ---------------------------------------------------------------------------

// Subject lines per variant (A = direct/benefit, B = curiosity/question)
const SUBJECTS = {
  hot: {
    A: [
      '{{firstName}}, quick question',
      'Chat with your disclosures',
      'Cost estimates in disclosures',
      'Should I close your file?',
    ],
    B: [
      'Still using ChatGPT for this?',
      'Between showings, {{firstName}}',
      'Know what to negotiate',
      'Not the right time?',
    ],
  },
  high: {
    A: [
      '{{firstName}}, disclosure reviews',
      'Chat with your disclosures',
      'Cost estimates in disclosures',
      'Closing your file, {{firstName}}',
    ],
    B: [
      'Still using ChatGPT for this?',
      'Between showings',
      'Walk in with numbers',
      'Last note from me',
    ],
  },
  medium: {
    A: [
      '{{firstName}}, a disclosure tool',
      'Chat with your disclosures',
      'Know what to negotiate',
      'Should I stop emailing?',
    ],
    B: [
      'ChatGPT enough for disclosures?',
      'Between showings',
      'Cost estimates in disclosures',
      'Last note, {{firstName}}',
    ],
  },
};

// Email bodies per tier — 4 emails for first touch
const BODIES = {
  hot: [
    // Email 1: The Hook — ChatGPT falls short, personalized with hookText
    `Hi {{firstName}},

{{hookText}}

Quick question — have you tried uploading disclosures to ChatGPT? It works for the first couple docs, but by the 3rd or 4th it starts losing context and giving you generic answers.

I built Discloser specifically for this. You upload the full packet — every document — and it keeps context across all of them. No rate limits, no lost threads.

First property is free. Takes 2 minutes.

discloser.co`,

    // Email 2: Value Add — chat with docs, between showings
    `Hi {{firstName}},

Different angle on Discloser — after uploading a disclosure packet, you can chat with the documents. Ask anything about the property and get answers with inline citations, right back to the source page.

Works well between showings. Compare what the seller disclosure says against the inspection report. Pull up a specific clause. Everything stays in context across all documents.

Try it on a current deal. First property is free.

discloser.co`,

    // Email 3: Cost estimates — impress clients
    `Hi {{firstName}},

One thing that surprises agents about Discloser — the analysis includes repair cost estimates for every finding.

Foundation crack mentioned on page 47? You'll see an estimated repair range. Roof issue in the inspection? Same thing.

Walk into a negotiation knowing what things actually cost. Your clients notice when you show up with numbers instead of guesses.

Upload takes 2 minutes. First property is free.

discloser.co`,

    // Email 4: Breakup
    `Hi {{firstName}},

No worries if the timing's off. I'll leave the link below in case you have a deal where the disclosure packet is a monster.

discloser.co — first property is always free.`,
  ],

  high: [
    // Email 1: The Hook — ChatGPT falls short, uses {{company}}
    `Hi {{firstName}},

Quick question — when you get a disclosure packet, do you upload it to ChatGPT? A lot of agents at {{company}} do. It works for a couple docs, but by the 3rd or 4th it starts losing context.

Discloser was built for this. Upload the full packet at once — every document. It keeps context across all of them and flags what matters.

First property is free. Takes 2 minutes.

discloser.co`,

    // Email 2: Value Add — chat with docs, between showings
    `Hi {{firstName}},

Different angle on Discloser — after uploading a disclosure packet, you can chat with the documents. Ask anything about the property and get answers with citations back to the source page.

Works well between showings. Compare what the seller disclosure says against the inspection report. Pull up a specific clause. Everything stays in context across all documents.

First property is free.

discloser.co`,

    // Email 3: Cost estimates
    `Hi {{firstName}},

Discloser includes repair cost estimates for every finding in the analysis. Foundation issue on page 47? You'll see a cost range. Roof concern in the inspection? Same thing.

Walk into your next negotiation with actual numbers instead of guesses. Your clients notice when you show up prepared.

Upload takes 2 minutes. First property is free.

discloser.co`,

    // Email 4: Breakup
    `Hi {{firstName}},

I'll stop reaching out. If disclosure reviews ever become a bottleneck, the link is below.

discloser.co — first property is always free.`,
  ],

  medium: [
    // Email 1: The Hook — ChatGPT falls short, universal
    `Hi {{firstName}},

A lot of agents upload disclosure packets to ChatGPT. It works for a document or two, but by the 3rd or 4th it starts losing context and gives you generic summaries.

I built Discloser specifically for disclosure reviews. Upload the entire packet at once. It reads every document, keeps context across all of them, and flags what your clients need to know.

First property is free. Takes 2 minutes.

discloser.co`,

    // Email 2: Value Add — chat with docs
    `Hi {{firstName}},

After uploading disclosures to Discloser, you can chat with the documents. Ask anything about the property and get answers with inline citations — right back to the source page.

Compare the seller disclosure against the inspection report. Pull up a specific clause between showings. Everything stays in context across the full packet.

First property is free.

discloser.co`,

    // Email 3: Cost estimates
    `Hi {{firstName}},

Discloser includes repair cost estimates for every finding. Foundation crack on page 47? You'll see a range. Roof issue? Same.

Walk into your next negotiation knowing what things cost. Clients notice when you come prepared with numbers instead of guesses.

Upload takes 2 minutes. First property is free.

discloser.co`,

    // Email 4: Breakup
    `Hi {{firstName}},

No worries if this isn't a priority right now. Link is below if you ever need it.

discloser.co — first property is free.`,
  ],
};

function firstTouchSequence(variant, tierName) {
  const t = tierName?.toLowerCase() || 'medium';
  const subjects = SUBJECTS[t]?.[variant] || SUBJECTS.medium[variant] || SUBJECTS.medium.A;
  const bodies = BODIES[t] || BODIES.medium;

  // Email 1 uses personalized subject + hook (populated by personalize-batch.js)
  // Falls back to static subject/hookText if personalized vars are empty
  const email1Body = bodies[0].replace('{{hookText}}', '{{personalized_hook}}');

  // 4-email drip: day 0, day 3, day 8, day 13
  return {
    steps: [
      { type: 'email', delay: 0, variants: [{ subject: '{{personalized_subject}}', body: email1Body }] },
      { type: 'email', delay: 3, variants: [{ subject: subjects[1], body: bodies[1] }] },
      { type: 'email', delay: 5, variants: [{ subject: subjects[2], body: bodies[2] }] },
      { type: 'email', delay: 5, variants: [{ subject: subjects[3], body: bodies[3] }] },
    ],
  };
}

function nurtureSequence() {
  // Campaign C: 2 emails, day 0 + day 6
  // Assumes familiarity — they opened but didn't reply to the first sequence
  return {
    steps: [
      {
        type: 'email',
        delay: 0,
        variants: [{
          subject: 'A different angle, {{firstName}}',
          body: `Hi {{firstName}},

Last time I mentioned Discloser for reviewing disclosure packets. Here's a different use — send the analysis to your buyer clients before the showing.

They get a plain-English summary with every finding ranked by severity, repair cost estimates, and exactly what to ask about during the inspection. Sets the stage before they walk in.

Upload takes 2 minutes. First property is still free.

discloser.co`,
        }],
      },
      {
        type: 'email',
        delay: 6,
        variants: [{
          subject: 'Still relevant, {{firstName}}?',
          body: `Hi {{firstName}},

If disclosure reviews aren't a pain point for you, fair enough. Link is below if that changes.

discloser.co`,
        }],
      },
    ],
  };
}

function softFollowupSequence() {
  // Campaign D: 1 email for replied-went-cold contacts
  return {
    steps: [
      {
        type: 'email',
        delay: 0,
        variants: [{
          subject: 'Following up, {{firstName}}',
          body: `Hi {{firstName}},

We connected a few weeks back about disclosure reviews. Wanted to check if the timing is better now.

If you have a packet you'd like to run through Discloser, the offer still stands — first property is free.

discloser.co`,
        }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Build campaign payloads
// ---------------------------------------------------------------------------

function buildCampaignPayload(campaignType) {
  const variant = campaignType.toUpperCase();
  const label = buildCampaignLabel(tier, variant, testName || (variant === 'C' ? 'nurture_v1' : 'followup_v1'));

  let sequence;
  if (campaignType === 'a' || campaignType === 'b') {
    sequence = firstTouchSequence(variant, tier);
  } else if (campaignType === 'c') {
    sequence = nurtureSequence();
  } else if (campaignType === 'd') {
    sequence = softFollowupSequence();
  }

  return {
    name: label,
    campaign_schedule: buildSchedule(),
    sequences: [sequence],
  };
}

// ---------------------------------------------------------------------------
// List campaigns
// ---------------------------------------------------------------------------

async function listCampaigns() {
  console.log('  Fetching campaigns from Instantly...\n');
  try {
    const result = await instantlyFetch('GET', '/campaigns?limit=100');
    const campaigns = result?.items || result?.data || result || [];

    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      console.log('  No campaigns found.');
      return;
    }

    console.log('  ┌──────────────────────────────────────┬──────────────────────────────┬──────────┐');
    console.log('  │ Campaign ID                          │ Name                         │ Status   │');
    console.log('  ├──────────────────────────────────────┼──────────────────────────────┼──────────┤');

    for (const c of campaigns) {
      const id = (c.id || '').slice(0, 36);
      const name = (c.name || '').slice(0, 28);
      const status = c.status === 1 ? 'active' : c.status === 0 ? 'paused' : String(c.status ?? '?');
      console.log(`  │ ${id.padEnd(36)} │ ${name.padEnd(28)} │ ${status.padEnd(8)} │`);
    }

    console.log('  └──────────────────────────────────────┴──────────────────────────────┴──────────┘');
    console.log(`\n  Total: ${campaigns.length} campaigns`);
  } catch (err) {
    console.error(`  Error listing campaigns: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SETUP INSTANTLY CAMPAIGNS');
  console.log('═══════════════════════════════════════════════════════════');

  const apiKey = getEnv('INSTANTLY_API_KEY') || getEnv('INSTANTLY_DISCLOSER_API_KEY');
  if (!apiKey) {
    console.error('  Error: INSTANTLY_API_KEY must be set in .env');
    process.exit(1);
  }

  if (listOnly) {
    await listCampaigns();
    return;
  }

  console.log(`\n  Tier: ${tier}`);
  if (testName) console.log(`  Test: ${testName}`);
  console.log(`  Campaign types: ${campaignTypes.join(', ').toUpperCase()}`);
  console.log(`  Schedule: Mon-Fri 9:00-11:00 AM ${timezone}`);
  console.log(`  Start date: ${startDate}`);

  const payloads = campaignTypes.map((type) => ({
    type: type.toUpperCase(),
    payload: buildCampaignPayload(type),
  }));

  // Show what will be created
  console.log('\n  Campaigns to create:');
  for (const { type, payload } of payloads) {
    const emailCount = payload.sequences[0].steps.length;
    console.log(`    Campaign ${type}: "${payload.name}" (${emailCount} email${emailCount > 1 ? 's' : ''})`);
  }

  if (dryRun) {
    console.log('\n  DRY RUN — showing full payloads:\n');
    for (const { type, payload } of payloads) {
      console.log(`  ── Campaign ${type}: ${payload.name} ──`);
      for (let i = 0; i < payload.sequences[0].steps.length; i++) {
        const step = payload.sequences[0].steps[i];
        const v = step.variants[0];
        const wordCount = v.body.split(/\s+/).filter(Boolean).length;
        console.log(`    Email ${i + 1} (day +${step.delay}, ~${wordCount} words):`);
        console.log(`      Subject: ${v.subject}`);
        console.log('      ─────────────────────────────────');
        for (const line of v.body.split('\n')) {
          console.log(`      ${line}`);
        }
        console.log('      ─────────────────────────────────');
      }
      console.log('');
    }
    return;
  }

  // Create campaigns
  console.log('\n  Creating campaigns in Instantly...');
  const created = [];

  for (const { type, payload } of payloads) {
    try {
      const result = await withRetry(async () => {
        return instantlyFetch('POST', '/campaigns', payload);
      }, 2, [3000, 10000]);

      const campaignId = result?.id || result?.data?.id || 'unknown';
      created.push({ type, name: payload.name, id: campaignId });
      console.log(`    ✓ Campaign ${type}: ${campaignId} — "${payload.name}"`);
    } catch (err) {
      console.error(`    ✗ Campaign ${type} failed: ${err.message}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  CAMPAIGNS CREATED');
  console.log('═══════════════════════════════════════════════════════════');

  if (created.length === 0) {
    console.log('  No campaigns created. Check errors above.');
    return;
  }

  for (const { type, name, id } of created) {
    console.log(`  Campaign ${type}: ${id}`);
    console.log(`    Name: ${name}`);
  }

  // Print env vars to set
  console.log('\n  Add to .env (or pass as CLI flags to push-to-instantly):');
  for (const { type, id } of created) {
    const envKey = `INSTANTLY_CAMPAIGN_${type}`;
    console.log(`    ${envKey}=${id}`);
  }

  console.log('\n  Next steps:');
  console.log('    1. Add the campaign IDs above to your .env');
  console.log('    2. Review email copy in Instantly UI — edit as needed');
  console.log('    3. Activate campaigns in Instantly when ready to send');

  // Note: campaigns are created in paused state by default
  console.log('\n  Note: Campaigns are created PAUSED. Activate in Instantly UI when ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
