// Content filter — recency thresholds, relevance classification, eligibility gate,
// pattern assignment (A/B/C rotation with conflict resolution)

import { toInt } from './twenty-client.js';

// ---------------------------------------------------------------------------
// Recency thresholds
// ---------------------------------------------------------------------------

const RECENCY = {
  IDEAL: 14,      // ≤ 14 days — reference post directly
  USABLE: 60,     // 15-60 days — say "a recent post" (don't specify date)
  STALE: 180,     // 61-180 days — skip LLM
  // > 180 or null — ANCIENT, skip LLM
};

export function classifyRecency(daysSincePost) {
  if (daysSincePost == null || daysSincePost >= 999) return 'ANCIENT';
  if (daysSincePost <= RECENCY.IDEAL) return 'IDEAL';
  if (daysSincePost <= RECENCY.USABLE) return 'USABLE';
  if (daysSincePost <= RECENCY.STALE) return 'STALE';
  return 'ANCIENT';
}

// ---------------------------------------------------------------------------
// Relevance filtering — blocklist for irrelevant content
// ---------------------------------------------------------------------------

const BLOCKLIST_POLITICAL = /\b(election|politic|democrat|republican|trump|biden|vote|ballot|congress|senate)\b/i;
const BLOCKLIST_PERSONAL = /\b(birthday|vacation|wedding|family|grateful|blessed|anniversary|funeral|rip|rest in peace)\b/i;
const BLOCKLIST_ENGAGEMENT = /\b(follow for follow|like for like|giveaway|tag a friend|share to win)\b/i;

export function isRelevantContent(text) {
  if (!text) return { relevant: false, reason: 'empty' };
  if (BLOCKLIST_POLITICAL.test(text)) return { relevant: false, reason: 'political' };
  if (BLOCKLIST_PERSONAL.test(text)) return { relevant: false, reason: 'personal' };
  if (BLOCKLIST_ENGAGEMENT.test(text)) return { relevant: false, reason: 'engagement_farming' };
  return { relevant: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Eligibility gate — determines if a lead qualifies for LLM personalization
// ---------------------------------------------------------------------------

const LLM_ELIGIBLE_TIERS = ['hot', 'high'];

export function assessEligibility(lead) {
  const tier = (lead.icp_tier || '').toLowerCase();

  // Gate 1: tier check — Medium/Low get rule-based
  if (!LLM_ELIGIBLE_TIERS.includes(tier)) {
    return { eligible: false, reason: 'low_tier', bestSource: null };
  }

  // Gate 2: check enrichment data exists
  const hasLinkedin = lead.linkedin_headline || lead.linkedin_recent_topic;
  const hasIG = lead.ig_followers || lead.ig_recent_addresses || lead.ig_neighborhoods;
  if (!hasLinkedin && !hasIG) {
    return { eligible: false, reason: 'no_enrichment', bestSource: null };
  }

  // Gate 3: recency — use whichever source is more recent
  const igDays = toInt(lead.ig_days_since_post, 999);
  const linkedinDays = toInt(lead.linkedin_days_since_post, 999);
  const bestDays = Math.min(igDays, linkedinDays);
  const bestSource = igDays <= linkedinDays ? 'instagram' : 'linkedin';
  const recency = classifyRecency(bestDays);

  if (recency === 'STALE' || recency === 'ANCIENT') {
    return { eligible: false, reason: 'stale_data', bestSource };
  }

  // Gate 4: relevance check on LinkedIn topic
  if (lead.linkedin_recent_topic) {
    const topicCheck = isRelevantContent(lead.linkedin_recent_topic);
    if (!topicCheck.relevant) {
      if (hasIG && igDays <= RECENCY.USABLE) {
        // IG data is usable, proceed
      } else {
        return { eligible: false, reason: 'irrelevant_data', bestSource };
      }
    }
  }

  return { eligible: true, reason: 'llm_eligible', bestSource, recency };
}

// ---------------------------------------------------------------------------
// Pattern assignment — A/B/C rotation with conflict resolution
// ---------------------------------------------------------------------------

const PATTERNS = ['A', 'B', 'C'];

/**
 * Assigns patterns to eligible leads.
 * Sort by region then ICP score descending. Rotate A, B, C.
 * Override rules:
 *   - Two contacts at the same brokerage cannot get the same pattern
 *   - Two contacts with the same linkedinRecentTopic cannot get the same pattern
 * On conflict: swap to the next pattern in rotation.
 */
export function assignPatterns(eligibleLeads) {
  // Sort: region ascending, then ICP score descending
  const sorted = [...eligibleLeads].sort((a, b) => {
    const regionCmp = (a.lead.region || '').localeCompare(b.lead.region || '');
    if (regionCmp !== 0) return regionCmp;
    return toInt(b.lead.icp_score) - toInt(a.lead.icp_score);
  });

  // Track patterns already assigned per brokerage and per topic
  const brokeragePatterns = new Map(); // company -> Set of assigned patterns
  const topicPatterns = new Map();     // topic -> Set of assigned patterns

  let rotationIdx = 0;

  for (const entry of sorted) {
    const lead = entry.lead;
    const company = (lead.company_name || '').toLowerCase().trim();
    const topic = (lead.linkedin_recent_topic || '').toLowerCase().trim();

    let pattern = PATTERNS[rotationIdx % PATTERNS.length];

    // Check brokerage conflict
    if (company && brokeragePatterns.has(company) && brokeragePatterns.get(company).has(pattern)) {
      pattern = findNonConflicting(pattern, brokeragePatterns.get(company));
    }

    // Check topic conflict
    if (topic && topicPatterns.has(topic) && topicPatterns.get(topic).has(pattern)) {
      const existingConflicts = new Set([
        ...(brokeragePatterns.get(company) || []),
        ...(topicPatterns.get(topic) || []),
      ]);
      pattern = findNonConflicting(pattern, existingConflicts);
    }

    entry.pattern = pattern;
    rotationIdx++;

    // Record assignments
    if (company) {
      if (!brokeragePatterns.has(company)) brokeragePatterns.set(company, new Set());
      brokeragePatterns.get(company).add(pattern);
    }
    if (topic) {
      if (!topicPatterns.has(topic)) topicPatterns.set(topic, new Set());
      topicPatterns.get(topic).add(pattern);
    }
  }

  return sorted;
}

function findNonConflicting(current, usedSet) {
  const currentIdx = PATTERNS.indexOf(current);
  for (let offset = 1; offset <= PATTERNS.length; offset++) {
    const candidate = PATTERNS[(currentIdx + offset) % PATTERNS.length];
    if (!usedSet.has(candidate)) return candidate;
  }
  // All patterns used — just return next in rotation (best effort)
  return PATTERNS[(currentIdx + 1) % PATTERNS.length];
}

// ---------------------------------------------------------------------------
// Batch eligibility report — for dry-run output
// ---------------------------------------------------------------------------

export function eligibilityReport(leads) {
  const counts = {
    llm_eligible: 0,
    low_tier: 0,
    stale_data: 0,
    irrelevant_data: 0,
    no_enrichment: 0,
  };
  const eligible = [];

  for (const lead of leads) {
    const result = assessEligibility(lead);
    counts[result.reason] = (counts[result.reason] || 0) + 1;
    if (result.eligible) {
      eligible.push({ lead, ...result });
    }
  }

  // Assign patterns to eligible leads
  const withPatterns = assignPatterns(eligible);

  return { counts, eligible: withPatterns, total: leads.length };
}
