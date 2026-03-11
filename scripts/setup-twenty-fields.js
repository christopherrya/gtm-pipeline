#!/usr/bin/env node

/**
 * Setup Twenty Fields — Create all custom fields on the People object
 *
 * Idempotent: checks for existing fields first, only creates missing ones.
 * Safe to re-run if it partially fails.
 *
 * Usage:
 *   node scripts/setup-twenty-fields.js [--dry-run]
 */

import { twentyFetch, hasTwentyConfig, getEnv } from './lib/twenty-client.js';

const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// People object metadata ID (confirmed in crm/crm.md)
// ---------------------------------------------------------------------------

const PEOPLE_OBJECT_METADATA_ID = getEnv(
  'TWENTY_PEOPLE_METADATA_ID',
  '93add812-8163-4b64-ac04-e75a4a86b7b9',
);

// ---------------------------------------------------------------------------
// Complete field spec — 15 existing + 12 new
// ---------------------------------------------------------------------------

const FIELD_SPEC = [
  // ── Existing 15 (created 2026-03-04) ──────────────────────────────────
  { name: 'icpScore',              label: 'ICP Score',               type: 'NUMBER' },
  { name: 'icpTier',               label: 'ICP Tier',                type: 'TEXT' },
  { name: 'triggerScore',          label: 'Trigger Score',           type: 'NUMBER' },
  { name: 'hookText',              label: 'Hook Text',               type: 'TEXT' },
  { name: 'hookVariant',           label: 'Hook Variant',            type: 'TEXT' },
  { name: 'hookSource',            label: 'Hook Source',             type: 'TEXT' },
  { name: 'igUsername',             label: 'IG Username',             type: 'TEXT' },
  { name: 'linkedinHeadline',      label: 'LinkedIn Headline',       type: 'TEXT' },
  { name: 'linkedinDaysSincePost', label: 'LinkedIn Days Since Post', type: 'NUMBER' },
  { name: 'linkedinRecentTopic',   label: 'LinkedIn Recent Topic',   type: 'TEXT' },
  { name: 'igFollowers',           label: 'IG Followers',            type: 'NUMBER' },
  { name: 'igDaysSincePost',       label: 'IG Days Since Post',      type: 'NUMBER' },
  { name: 'externalLeadId',        label: 'External Lead ID',        type: 'TEXT' },
  { name: 'funnelStage',           label: 'Funnel Stage',            type: 'TEXT' },
  { name: 'leadSource',            label: 'Lead Source',             type: 'TEXT' },

  // ── New 12 (mass email pipeline) ──────────────────────────────────────
  { name: 'region',                label: 'Region',                  type: 'TEXT' },
  { name: 'abVariant',             label: 'A/B Variant',             type: 'TEXT' },
  { name: 'lastOutreachDate',      label: 'Last Outreach Date',      type: 'TEXT' },
  { name: 'instantlyCampaignId',   label: 'Instantly Campaign ID',   type: 'TEXT' },
  { name: 'replyToAddress',        label: 'Reply-To Address',        type: 'TEXT' },
  { name: 'locationRaw',           label: 'Location Raw',            type: 'TEXT' },
  { name: 'outreachStatus',        label: 'Outreach Status',         type: 'TEXT' },
  { name: 'assignedInbox',         label: 'Assigned Inbox',          type: 'TEXT' },
  { name: 'abTestName',            label: 'A/B Test Name',           type: 'TEXT' },
  { name: 'abTestHistory',         label: 'A/B Test History',        type: 'TEXT' },
  { name: 'campaignLabel',         label: 'Campaign Label',          type: 'TEXT' },
  { name: 'reEngageAttempts',      label: 'Re-Engage Attempts',      type: 'NUMBER' },

  // ── Instagram enrichment (LLM personalization) ──────────────────────
  { name: 'igRecentAddresses',   label: 'IG Recent Addresses',    type: 'TEXT' },
  { name: 'igNeighborhoods',     label: 'IG Neighborhoods',       type: 'TEXT' },
  { name: 'igListingPostsCount', label: 'IG Listing Posts Count', type: 'NUMBER' },
  { name: 'igSoldPostsCount',    label: 'IG Sold Posts Count',    type: 'NUMBER' },

  // ── Event timestamps (tracking when each milestone happened) ────────
  { name: 'firstContactedAt',     label: 'First Contacted At',      type: 'TEXT' },
  { name: 'emailOpenedAt',        label: 'Email Opened At',         type: 'TEXT' },
  { name: 'repliedAt',            label: 'Replied At',              type: 'TEXT' },
  { name: 'opportunityEnteredAt', label: 'Opportunity Entered At',  type: 'TEXT' },
];

// ---------------------------------------------------------------------------
// Fetch existing fields from Twenty metadata API
// ---------------------------------------------------------------------------

async function getExistingFields() {
  // Try fetching all fields, then filter to People object client-side
  const endpoints = [
    '/rest/metadata/fields',
    `/rest/metadata/objects/${PEOPLE_OBJECT_METADATA_ID}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const result = await twentyFetch('GET', endpoint);
      // Handle different response shapes
      let fields = result?.data?.fields || result?.fields || result?.data || [];
      if (!Array.isArray(fields) && result?.data?.object?.fields) {
        fields = result.data.object.fields;
      }
      if (Array.isArray(fields) && fields.length > 0) {
        // Filter to People object if we got all fields
        const peopleFields = fields.filter(
          (f) => !f.objectMetadataId || f.objectMetadataId === PEOPLE_OBJECT_METADATA_ID,
        );
        const names = new Set(peopleFields.map((f) => f.name));
        if (names.size > 0) return names;
      }
    } catch {
      // Try next endpoint
    }
  }

  console.log('  Warning: Could not list existing fields from metadata API');
  console.log('  Will attempt to create all fields (duplicates will be skipped on error)');
  return null; // null means "unknown, try everything"
}

// ---------------------------------------------------------------------------
// Create a single field
// ---------------------------------------------------------------------------

async function createField(field) {
  const payload = {
    name: field.name,
    label: field.label,
    type: field.type,
    objectMetadataId: PEOPLE_OBJECT_METADATA_ID,
  };

  try {
    await twentyFetch('POST', '/rest/metadata/fields', payload);
    return 'created';
  } catch (err) {
    const msg = err.message || '';
    // Field already exists — treat as success
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('409') || msg.includes('400')) {
      return 'exists';
    }
    return `error: ${msg}`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SETUP TWENTY FIELDS — People Object Custom Fields');
  console.log('═══════════════════════════════════════════════════════════');

  if (!hasTwentyConfig()) {
    console.error('  Error: TWENTY_BASE_URL and TWENTY_API_KEY must be set in .env');
    process.exit(1);
  }

  console.log(`\n  People object metadata ID: ${PEOPLE_OBJECT_METADATA_ID}`);
  console.log(`  Total fields in spec: ${FIELD_SPEC.length} (15 existing + 12 pipeline + 4 IG enrichment + 4 timestamps)`);

  // Check which fields already exist
  console.log('\n  Checking existing fields...');
  const existingFields = await getExistingFields();

  let toCreate = FIELD_SPEC;
  let skippedCount = 0;

  if (existingFields) {
    toCreate = FIELD_SPEC.filter((f) => {
      if (existingFields.has(f.name)) {
        skippedCount++;
        return false;
      }
      return true;
    });
    console.log(`  Already exist: ${skippedCount}`);
    console.log(`  To create: ${toCreate.length}`);
  } else {
    console.log('  Could not determine existing fields — will try all');
  }

  if (toCreate.length === 0) {
    console.log('\n  All fields already exist. Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('\n  DRY RUN — would create these fields:');
    for (const field of toCreate) {
      console.log(`    ${field.name} (${field.type}) — "${field.label}"`);
    }
    return;
  }

  // Create missing fields
  console.log('\n  Creating fields...');
  const results = { created: 0, exists: 0, errors: 0, errorDetails: [] };

  for (const field of toCreate) {
    const status = await createField(field);
    if (status === 'created') {
      results.created++;
      console.log(`    ✓ ${field.name} (${field.type})`);
    } else if (status === 'exists') {
      results.exists++;
      console.log(`    – ${field.name} (already exists)`);
    } else {
      results.errors++;
      results.errorDetails.push({ field: field.name, error: status });
      console.log(`    ✗ ${field.name} — ${status}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SETUP COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Created: ${results.created}`);
  console.log(`  Already existed: ${skippedCount + results.exists}`);
  if (results.errors > 0) {
    console.log(`  Errors: ${results.errors}`);
    for (const { field, error } of results.errorDetails) {
      console.log(`    ${field}: ${error}`);
    }
    console.log('\n  Re-run this script to retry failed fields.');
  }

  // Verify total
  const totalReady = skippedCount + results.exists + results.created;
  console.log(`\n  Fields ready: ${totalReady}/${FIELD_SPEC.length}`);
  if (totalReady === FIELD_SPEC.length) {
    console.log('  All fields confirmed. CRM is ready for imports.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
