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

// Subject lines per variant (A = ChatGPT comparison, B = speed + cost estimates)
const SUBJECTS = {
  hot: {
    A: [
      '{{firstName}}, tried ChatGPT on a disclosure packet?',
      '{{firstName}}, ask your disclosure packet anything',
      "Here's what that roof repair actually costs, {{firstName}}",
      "{{firstName}}, almost missed what's on page 47",
    ],
    B: [
      '{{firstName}}, 247 pages analyzed in under 3 minutes',
      '{{firstName}}, no more splitting disclosure docs',
      '{{firstName}}, chat with your disclosures between showings',
      '{{firstName}}, last note about that disclosure packet',
    ],
  },
  high: {
    A: [
      "{{firstName}}, here's what most agents miss in disclosures",
      '{{firstName}}, what if you could question your disclosures?',
      'Found repair estimates buried on page 34, {{firstName}}',
      '{{firstName}}, ran the numbers on your next disclosure',
    ],
    B: [
      '{{firstName}}, what that foundation crack actually costs',
      '{{firstName}}, upload the full packet — no splitting',
      '{{firstName}}, chat with your disclosures between showings',
      "Here's the 3-minute version, {{firstName}}",
    ],
  },
  medium: {
    A: [
      '{{firstName}}, check page 47 of your next disclosure',
      '{{firstName}}, your disclosures can answer questions now',
      "Here's your negotiation leverage, {{firstName}}",
      "{{firstName}}, here's what that foundation crack actually means",
    ],
    B: [
      '{{firstName}}, every finding with a cost estimate attached',
      '{{firstName}}, no more splitting disclosure docs',
      '{{firstName}}, chat with your disclosures between showings',
      '{{firstName}}, 3 minutes from upload to full breakdown',
    ],
  },
};

// Signature appended to every email
const SIGNATURE = `\n—\n{{sender_name}}\nDiscloser | Smarter property disclosures\ndiscloser.co`;

// Email bodies — Variant A: ChatGPT comparison
const BODIES_A = {
  hot: [
    // Email 1: The Hook — personalized with hookText
    `Hi {{firstName}},

{{hookText}}

Quick question — have you tried uploading disclosures to ChatGPT? It works for the first couple docs, but by the 3rd or 4th it starts losing context and giving you generic answers.

I built Discloser specifically for this. You upload the full packet — every document — and it keeps context across all of them. No rate limits, no lost threads.

First property is free. Takes 2 minutes.${SIGNATURE}`,

    // Email 2: Value Add — chat with docs
    `Hi {{firstName}},

Different angle on Discloser — after uploading a disclosure packet, you can chat with the documents. Ask anything about the property and get answers with inline citations, right back to the source page.

Works well between showings. Compare what the seller disclosure says against the inspection report. Pull up a specific clause. Everything stays in context across all documents.

Try it on a current deal. First property is free.${SIGNATURE}`,

    // Email 3: Cost estimates
    `Hi {{firstName}},

One thing that surprises agents about Discloser — the analysis includes repair cost estimates for every finding.

Foundation crack mentioned on page 47? You'll see an estimated repair range. Roof issue in the inspection? Same thing.

Walk into a negotiation knowing what things actually cost. Your clients notice when you show up with numbers instead of guesses.

Upload takes 2 minutes. First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last one from me. Next time you get a 200-page disclosure packet, run it through Discloser before the inspection.

First property is free — discloser.co${SIGNATURE}`,
  ],

  high: [
    // Email 1: The Hook — uses {{company}}
    `Hi {{firstName}},

Quick question — when you get a disclosure packet, do you upload it to ChatGPT? A lot of agents at {{company}} do. It works for a couple docs, but by the 3rd or 4th it starts losing context.

Discloser was built for this. Upload the full packet at once — every document. It keeps context across all of them and flags what matters.

First property is free. Takes 2 minutes.${SIGNATURE}`,

    // Email 2: Value Add — chat with docs
    `Hi {{firstName}},

Different angle on Discloser — after uploading a disclosure packet, you can chat with the documents. Ask anything about the property and get answers with citations back to the source page.

Works well between showings. Compare what the seller disclosure says against the inspection report. Pull up a specific clause. Everything stays in context across all documents.

First property is free.${SIGNATURE}`,

    // Email 3: Cost estimates
    `Hi {{firstName}},

Discloser includes repair cost estimates for every finding in the analysis. Foundation issue on page 47? You'll see a cost range. Roof concern in the inspection? Same thing.

Walk into your next negotiation with actual numbers instead of guesses. Your clients notice when you show up prepared.

Upload takes 2 minutes. First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last note from me. When a disclosure packet hits your desk and you need answers fast, Discloser reads the full thing in two minutes.

First property is free — discloser.co${SIGNATURE}`,
  ],

  medium: [
    // Email 1: The Hook — universal
    `Hi {{firstName}},

A lot of agents upload disclosure packets to ChatGPT. It works for a document or two, but by the 3rd or 4th it starts losing context and gives you generic summaries.

I built Discloser specifically for disclosure reviews. Upload the entire packet at once. It reads every document, keeps context across all of them, and flags what your clients need to know.

First property is free. Takes 2 minutes.${SIGNATURE}`,

    // Email 2: Value Add — chat with docs
    `Hi {{firstName}},

After uploading disclosures to Discloser, you can chat with the documents. Ask anything about the property and get answers with inline citations — right back to the source page.

Compare the seller disclosure against the inspection report. Pull up a specific clause between showings. Everything stays in context across the full packet.

First property is free.${SIGNATURE}`,

    // Email 3: Cost estimates
    `Hi {{firstName}},

Discloser includes repair cost estimates for every finding. Foundation crack on page 47? You'll see a range. Roof issue? Same.

Walk into your next negotiation knowing what things cost. Clients notice when you come prepared with numbers instead of guesses.

Upload takes 2 minutes. First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last one from me. If a disclosure packet ever bogs down a deal, Discloser breaks it down in two minutes flat.

First property is free — discloser.co${SIGNATURE}`,
  ],
};

// Email bodies — Variant B: Speed + cost estimates
const BODIES_B = {
  hot: [
    // Email 1: Hook — speed + cost estimates (personalized)
    `Hi {{firstName}},

{{hookText}}

Last disclosure packet I ran through Discloser was 247 pages. Full analysis back in under 3 minutes — every finding ranked by severity, with repair cost estimates attached.

Foundation crack on page 182? You see a dollar range. Roof issue in the inspection report? Same thing. Walk into the negotiation knowing what things actually cost.

First property is free. Takes 2 minutes to upload.${SIGNATURE}`,

    // Email 2: Full packet upload
    `Hi {{firstName}},

Most tools make you upload disclosure documents one at a time. By the 3rd or 4th, you're managing separate conversations and losing track of which doc said what.

Discloser takes the entire packet at once — seller disclosure, inspection, pest report, all of it. Keeps context across every document so findings from one get cross-referenced against the others.

Try it on a current deal. First property is free.${SIGNATURE}`,

    // Email 3: Chat with docs
    `Hi {{firstName}},

One more thing about Discloser — after the analysis, you can chat with the documents. Ask anything about the property and get answers with inline citations, right back to the source page.

Compare what the seller disclosure says against the inspection report. Pull up a specific clause between showings. Everything stays in context.

First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last one from me. Next time a 200-page disclosure packet hits your desk, upload it to Discloser. Full breakdown in under 3 minutes, repair costs included.

First property is free — discloser.co${SIGNATURE}`,
  ],

  high: [
    // Email 1: Hook — speed + cost estimates (uses {{company}})
    `Hi {{firstName}},

Agents at {{company}} review a lot of disclosure packets. Most spend hours reading through them manually, or upload a few pages to ChatGPT and hope for the best.

Discloser reads the full packet in under 3 minutes. Every finding ranked by severity. Repair cost estimates attached — foundation issue, roof concern, whatever it finds, you see a dollar range.

First property is free. Takes 2 minutes to upload.${SIGNATURE}`,

    // Email 2: Full packet upload
    `Hi {{firstName}},

Most tools make you upload disclosure documents one at a time. By the 3rd or 4th, you're managing separate conversations and context is gone.

Discloser takes the full packet at once — seller disclosure, inspection, pest report, all of it. Cross-references findings across every document automatically.

First property is free.${SIGNATURE}`,

    // Email 3: Chat with docs
    `Hi {{firstName}},

After uploading disclosures to Discloser, you can chat with the documents. Ask anything about the property and get answers with citations back to the source page.

Works well between showings. Compare the seller disclosure against the inspection report. Pull up a specific clause. Everything stays in context.

First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last note from me. Next disclosure packet that lands on your desk — upload it to Discloser. Full breakdown in 3 minutes, costs included.

First property is free — discloser.co${SIGNATURE}`,
  ],

  medium: [
    // Email 1: Hook — speed + cost estimates (universal)
    `Hi {{firstName}},

The last disclosure packet I ran through Discloser was 247 pages. Full analysis came back in under 3 minutes — every finding ranked by severity, with estimated repair costs attached.

Foundation crack buried in the report? You see a dollar range. Roof issue? Same thing. You walk into the negotiation knowing what things actually cost instead of guessing.

First property is free. Takes 2 minutes to upload.${SIGNATURE}`,

    // Email 2: Full packet upload
    `Hi {{firstName}},

One thing about Discloser — it takes the entire disclosure packet at once. Seller disclosure, inspection report, pest report, all of it. No splitting documents into separate uploads.

It cross-references findings across every document automatically, so nothing falls through the cracks between reports.

First property is free.${SIGNATURE}`,

    // Email 3: Chat with docs
    `Hi {{firstName}},

After uploading disclosures to Discloser, you can chat with the documents. Ask anything about the property and get answers with inline citations — right back to the source page.

Compare the seller disclosure against the inspection report between showings. Pull up a specific clause. Full context across the entire packet.

First property is free.${SIGNATURE}`,

    // Email 4: Breakup
    `Hi {{firstName}},

Last one from me. Next time a disclosure packet slows down a deal, run it through Discloser. Full breakdown in 3 minutes, repair costs included.

First property is free — discloser.co${SIGNATURE}`,
  ],
};

/**
 * Convert plain text email body to HTML for Instantly.
 * Double newlines become paragraph breaks, single newlines become <br>.
 */
function toHtml(text) {
  return text
    .split('\n\n')
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function firstTouchSequence(variant, tierName) {
  const t = tierName?.toLowerCase() || 'medium';
  const subjects = SUBJECTS[t]?.[variant] || SUBJECTS.medium[variant] || SUBJECTS.medium.A;
  const bodiesMap = variant === 'B' ? BODIES_B : BODIES_A;
  const bodies = bodiesMap[t] || bodiesMap.medium;

  // Email 1 uses personalized subject + hook (populated by personalize-batch.js)
  // Falls back to static subject/hookText if personalized vars are empty
  const email1Body = bodies[0].replace('{{hookText}}', '{{personalized_hook}}');

  // 4-email drip: day 0, day 3, day 8, day 13
  return {
    steps: [
      { type: 'email', delay: 0, variants: [{ subject: '{{personalized_subject}}', body: toHtml(email1Body) }] },
      { type: 'email', delay: 3, variants: [{ subject: subjects[1], body: toHtml(bodies[1]) }] },
      { type: 'email', delay: 5, variants: [{ subject: subjects[2], body: toHtml(bodies[2]) }] },
      { type: 'email', delay: 5, variants: [{ subject: subjects[3], body: toHtml(bodies[3]) }] },
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
          subject: "{{firstName}}, here's what I sent a buyer before their showing",
          body: toHtml(`Hi {{firstName}},

Last time I mentioned Discloser for reviewing disclosure packets. Here's a different use — send the analysis to your buyer clients before the showing.

They get a plain-English summary with every finding ranked by severity, repair cost estimates, and exactly what to ask about during the inspection. Sets the stage before they walk in.

Upload takes 2 minutes. First property is still free.${SIGNATURE}`),
        }],
      },
      {
        type: 'email',
        delay: 6,
        variants: [{
          subject: '{{firstName}}, broke down a 200-page packet in 2 minutes',
          body: toHtml(`Hi {{firstName}},

Either way — next time you're staring at a thick disclosure packet, give Discloser a shot. Two minutes, full breakdown, first property free.

discloser.co${SIGNATURE}`),
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
          subject: '{{firstName}}, your free disclosure analysis is still here',
          body: toHtml(`Hi {{firstName}},

We connected a few weeks back about disclosure reviews. Wanted to check if the timing is better now.

If you have a packet you'd like to run through Discloser, the offer still stands — first property is free.${SIGNATURE}`),
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
