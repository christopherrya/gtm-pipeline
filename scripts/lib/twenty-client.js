// Shared Twenty CRM API client for mass email pipeline scripts
// Extracted from orchestrator/lib/crm/twenty.js with batch ops, pagination, and rate limiting

import { createHash } from 'crypto';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BATCH_SIZE, RATE_LIMIT_PER_MIN, extractRegion, icpTier } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

export function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function igHandle(v) {
  if (!v) return '';
  return String(v).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '').replace(/^@/, '');
}

export function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export async function withRetry(fn, retries, delaysMs = [5000, 20000, 60000]) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) throw error;
      const wait = delaysMs[Math.min(attempt, delaysMs.length - 1)];
      await new Promise((r) => setTimeout(r, wait));
      attempt += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — sliding window, max RATE_LIMIT_PER_MIN calls/min
// ---------------------------------------------------------------------------

const callTimestamps = [];

async function waitForRateLimit() {
  const now = Date.now();
  // Remove timestamps older than 60 seconds
  while (callTimestamps.length > 0 && callTimestamps[0] < now - 60000) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_LIMIT_PER_MIN) {
    const oldest = callTimestamps[0];
    const waitMs = oldest + 60000 - now + 50; // 50ms buffer
    await new Promise((r) => setTimeout(r, waitMs));
  }
  callTimestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// Twenty API HTTP client
// ---------------------------------------------------------------------------

function twentyBaseUrl() {
  return getEnv('TWENTY_BASE_URL', '').replace(/\/+$/, '');
}

export function hasTwentyConfig() {
  return Boolean(twentyBaseUrl() && getEnv('TWENTY_API_KEY'));
}

export async function twentyFetch(method, path, body, timeoutMs = 30000) {
  await waitForRateLimit();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${getEnv('TWENTY_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const response = await fetch(`${twentyBaseUrl()}${path}`, opts);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twenty API ${method} ${path} failed: ${response.status} ${text}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export async function paginateAll(objectName, filter = {}) {
  const allRecords = [];
  let cursor = null;
  const filterParam = Object.keys(filter).length > 0
    ? `&filter=${encodeURIComponent(JSON.stringify(filter))}`
    : '';

  while (true) {
    const cursorParam = cursor ? `&lastCursor=${encodeURIComponent(cursor)}` : '';
    const result = await twentyFetch(
      'GET',
      `/api/objects/${objectName}?limit=60${filterParam}${cursorParam}`
    );
    const records = result?.data?.[objectName] || result?.data || [];
    if (!Array.isArray(records) || records.length === 0) break;
    allRecords.push(...records);
    // Twenty uses cursor-based pagination; check for pageInfo or last record id
    const pageInfo = result?.data?.pageInfo || result?.pageInfo;
    if (pageInfo?.hasNextPage && pageInfo?.endCursor) {
      cursor = pageInfo.endCursor;
    } else if (records.length === 60) {
      // Fallback: use last record id as cursor
      cursor = records[records.length - 1].id;
    } else {
      break;
    }
  }
  return allRecords;
}

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

export async function loadEmailIdMap() {
  const people = await paginateAll('people');
  const map = new Map();
  for (const p of people) {
    const email = p.emails?.primaryEmail || '';
    if (email) map.set(email.toLowerCase(), p.id);
  }
  return map;
}

export async function loadCompanyNameMap() {
  const companies = await paginateAll('companies');
  const map = new Map();
  for (const c of companies) {
    const name = c.name || '';
    if (name) map.set(name.toLowerCase(), c.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

export async function batchCreate(objectName, records) {
  const results = { created: 0, errors: 0, errorDetails: [] };
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(async () => {
        await twentyFetch('POST', `/api/objects/${objectName}/batch`, chunk);
      }, 2, [3000, 10000]);
      results.created += chunk.length;
    } catch (error) {
      // Fall back to individual creates for the failed chunk
      for (const record of chunk) {
        try {
          await twentyFetch('POST', `/api/objects/${objectName}`, record);
          results.created += 1;
        } catch (err) {
          results.errors += 1;
          if (results.errorDetails.length < 30) {
            results.errorDetails.push(err.message);
          }
        }
      }
    }
  }
  return results;
}

export async function batchUpdate(objectName, updates) {
  const results = { updated: 0, errors: 0, errorDetails: [] };
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(async () => {
        await twentyFetch('PATCH', `/api/objects/${objectName}/batch`, chunk);
      }, 2, [3000, 10000]);
      results.updated += chunk.length;
    } catch (error) {
      // Fall back to individual updates
      for (const update of chunk) {
        try {
          await twentyFetch('PATCH', `/api/objects/${objectName}/${update.id}`, update);
          results.updated += 1;
        } catch (err) {
          results.errors += 1;
          if (results.errorDetails.length < 30) {
            results.errorDetails.push(err.message);
          }
        }
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Company upsert
// ---------------------------------------------------------------------------

export async function upsertCompany(name, domain, companyMap) {
  const key = name.toLowerCase();
  if (companyMap.has(key)) return companyMap.get(key);

  // Try to find existing
  const filter = { and: [{ name: { ilike: `%${name}%` } }] };
  const encoded = encodeURIComponent(JSON.stringify(filter));
  try {
    const result = await twentyFetch('GET', `/api/objects/companies?filter=${encoded}&limit=1`);
    const records = result?.data?.companies || result?.data || [];
    if (Array.isArray(records) && records.length > 0) {
      companyMap.set(key, records[0].id);
      return records[0].id;
    }
  } catch {
    // Fall through to create
  }

  // Create new
  const body = {
    name,
    domainName: { primaryLinkUrl: domain || '' },
  };
  try {
    const created = await twentyFetch('POST', '/api/objects/companies', body);
    const id = created?.data?.id || created?.id || null;
    if (id) companyMap.set(key, id);
    return id;
  } catch (err) {
    console.error(`  Failed to create company "${name}": ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contact → Twenty Person mapping (extended with 7 new fields)
// ---------------------------------------------------------------------------

export function contactToTwentyPerson(contact, companyId = null) {
  const email = contact.Email || contact['Work Email'] || '';
  const linkedinUrl = contact['LinkedIn Profile'] || contact.linkedin_url || '';
  const rawLocation = contact.Location || contact.location || contact.City || '';

  const person = {
    name: {
      firstName: contact['First Name'] || '',
      lastName: contact['Last Name'] || '',
    },
    emails: {
      primaryEmail: email,
    },
    jobTitle: contact.job_title || contact['Job Title'] || '',
    linkedinLink: { primaryLinkUrl: linkedinUrl, primaryLinkLabel: 'LinkedIn' },
    // Existing custom fields
    icpScore: toInt(contact.icp_score),
    icpTier: contact.icp_tier || icpTier(toInt(contact.icp_score)),
    triggerScore: toInt(contact.trigger_score),
    hookText: contact.hook_text || contact.best_hook || '',
    hookVariant: contact.hook_variant || '',
    hookSource: contact.hook_source || '',
    igUsername: igHandle(contact['IG handle'] || contact.ig_username || ''),
    linkedinHeadline: (contact.linkedin_headline || '').substring(0, 255),
    linkedinDaysSincePost: toInt(contact.linkedin_days_since_post, 999),
    linkedinRecentTopic: (contact.linkedin_recent_topic || '').substring(0, 50),
    igFollowers: toInt(contact.ig_followers),
    igDaysSincePost: toInt(contact.ig_days_since_post, 999),
    igRecentAddresses: (contact.ig_recent_addresses || contact.igRecentAddresses || '').substring(0, 500),
    igNeighborhoods: (contact.ig_neighborhoods || contact.igNeighborhoods || '').substring(0, 255),
    igListingPostsCount: toInt(contact.ig_listing_posts || contact.igListingPostsCount),
    igSoldPostsCount: toInt(contact.ig_sold_posts || contact.igSoldPostsCount),
    externalLeadId: contact.external_lead_id || '',
    leadSource: contact.source_primary || contact.leadSource || 'Clay',
    // New fields (8)
    region: contact.region || extractRegion(rawLocation),
    abVariant: contact.abVariant || contact.ab_variant || '',
    lastOutreachDate: contact.lastOutreachDate || '',
    instantlyCampaignId: contact.instantlyCampaignId || '',
    replyToAddress: contact.replyToAddress || '',
    locationRaw: rawLocation,
    outreachStatus: contact.outreachStatus || '',
    assignedInbox: contact.assignedInbox || '',
    abTestName: contact.abTestName || '',
    abTestHistory: contact.abTestHistory || '',
    campaignLabel: contact.campaignLabel || '',
    reEngageAttempts: toInt(contact.reEngageAttempts),
  };

  if (companyId) {
    person.companyId = companyId;
  }

  // Set funnel stage
  person.funnelStage = contact.funnelStage || contact.funnel_stage || 'new';

  return person;
}

// ---------------------------------------------------------------------------
// Find person by email
// ---------------------------------------------------------------------------

export async function findPersonByEmail(email) {
  const encoded = encodeURIComponent(
    JSON.stringify({ and: [{ emails: { primaryEmail: { eq: email } } }] })
  );
  const result = await twentyFetch('GET', `/api/objects/people?filter=${encoded}&limit=1`);
  const records = result?.data?.people || result?.data || [];
  return Array.isArray(records) && records.length > 0 ? records[0] : null;
}
