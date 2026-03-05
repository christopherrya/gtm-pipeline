// Constants for the mass email pipeline (Bucket 1)

export const FUNNEL_STAGES = [
  'new',
  'scored',
  'queued',
  'contacted',
  'opened',
  'replied',
  'bounced',
  'unsubscribed',
  // Post-sequence stages
  'sequence_complete',  // all emails sent, never opened
  'opened_no_reply',    // opened at least one, never replied
  'replied_went_cold',  // replied then went silent
  // Nurture campaign (Campaign C) — opened-but-didn't-reply, assumes familiarity
  'nurture',            // currently in Campaign C (2 emails, different angle)
  'nurture_complete',   // finished Campaign C, still no reply
  // Terminal / re-entry stages
  're_engage_ready',    // cooldown expired, eligible for re-enrichment + new first touch
  'dropped',            // permanently removed (bounced, no alt email found)
];

export const ICP_TIER_THRESHOLDS = {
  hot: 90,
  high: 70,
  medium: 55,
};

export function icpTier(score) {
  if (score >= ICP_TIER_THRESHOLDS.hot) return 'hot';
  if (score >= ICP_TIER_THRESHOLDS.high) return 'high';
  if (score >= ICP_TIER_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export const REGION_MAP = {
  'SF Bay': [
    'san francisco', 'sf', 'bay area', 'oakland', 'san jose', 'berkeley',
    'palo alto', 'fremont', 'san mateo', 'redwood city', 'mountain view',
    'sunnyvale', 'santa clara', 'walnut creek', 'concord', 'hayward',
    'daly city', 'marin', 'sausalito', 'mill valley', 'tiburon',
  ],
  'LA': [
    'los angeles', 'la', 'beverly hills', 'santa monica', 'hollywood',
    'pasadena', 'burbank', 'glendale', 'long beach', 'torrance',
    'manhattan beach', 'hermosa beach', 'west hollywood', 'brentwood',
    'bel air', 'malibu', 'calabasas', 'encino', 'sherman oaks',
  ],
  'Sacramento': [
    'sacramento', 'elk grove', 'roseville', 'folsom', 'rocklin',
    'citrus heights', 'rancho cordova', 'woodland', 'davis',
    'west sacramento', 'natomas',
  ],
  'San Diego': [
    'san diego', 'la jolla', 'del mar', 'encinitas', 'carlsbad',
    'oceanside', 'escondido', 'chula vista', 'coronado', 'pacific beach',
    'mission beach', 'point loma', 'rancho santa fe', 'solana beach',
  ],
};

export function extractRegion(rawLocation) {
  if (!rawLocation) return '';
  const lower = String(rawLocation).toLowerCase();
  for (const [region, patterns] of Object.entries(REGION_MAP)) {
    if (patterns.some((p) => lower.includes(p))) return region;
  }
  return '';
}

export const INSTANTLY_STATUS_MAP = {
  email_sent: 'contacted',
  email_opened: 'opened',
  replied: 'replied',
  bounced: 'bounced',
  unsubscribed: 'unsubscribed',
};

export const SUPPRESSED_STAGES = [
  'contacted', 'opened', 'replied', 'bounced', 'unsubscribed',
  'sequence_complete', 'opened_no_reply', 'replied_went_cold',
  'nurture', 'nurture_complete', 'dropped',
];

export const BATCH_SIZE = 60;
export const RATE_LIMIT_PER_MIN = 100;
export const COOLDOWN_DAYS = 14;
export const SEQUENCE_DURATION_DAYS = 14; // 4-email drip runs 10-14 days

// Re-engagement rules — cooldown in days before eligible for re-enrichment + new campaign
export const RE_ENGAGE_RULES = {
  // Never opened any email: subject lines didn't land. Different angle entirely.
  sequence_complete: {
    cooldownDays: 75,        // 60-90 day range, use midpoint
    action: 're_enrich',     // must re-enrich before re-engage
    maxAttempts: 2,          // try twice total, then drop
    notes: 'Different subject lines, different angle. Same messaging won\'t work.',
  },
  // Opened but never replied: curious but not compelled. Goes to Campaign C (nurture).
  // Campaign C assumes familiarity — skip cold intro, go straight to value, different angle.
  // 2 emails spaced further apart (day 0 and day 5-7), not a full 4-email sequence.
  opened_no_reply: {
    cooldownDays: 17,        // 14-21 day range, use midpoint
    action: 'nurture',       // push to Campaign C, not re-enrich
    maxAttempts: 1,          // one nurture attempt, then 90-day cooldown
    notes: 'Campaign C: assumes they know your name. Different value prop or trigger event.',
  },
  // Finished Campaign C (nurture), still no reply. Long cooldown then back to first touch.
  nurture_complete: {
    cooldownDays: 90,
    action: 're_enrich',     // enough time has passed, they've probably forgotten you
    maxAttempts: 1,          // one more first touch attempt after nurture fails
    notes: 'Re-enrich via Apify, completely fresh messaging, back to first touch (A/B).',
  },
  // Replied but went cold: soft single follow-up, not a full sequence.
  replied_went_cold: {
    cooldownDays: 17,        // 14-21 day range, use midpoint
    action: 'soft_followup', // single email, not a full sequence
    maxAttempts: 1,          // one soft follow-up only, then 90-day re-engage
    fallbackCooldownDays: 90,
    notes: 'Single soft follow-up only. "Wanted to see if timing is better now."',
  },
  // Bounced: try alt email via Clay/Apify, otherwise drop permanently.
  bounced: {
    cooldownDays: 0,
    action: 'find_alt_email', // attempt enrichment for alternate address
    maxAttempts: 1,
    notes: 'Try to find alternate email. If none found, move to dropped.',
  },
  // Unsubscribed: never re-engage. Permanent removal.
  unsubscribed: {
    cooldownDays: Infinity,
    action: 'never',
    maxAttempts: 0,
    notes: 'Remove permanently. Do not re-engage under any circumstances.',
  },
};

/**
 * Returns whether a contact is eligible for re-engagement based on their
 * current stage and when their last outreach ended.
 */
export function isReEngageEligible(stage, lastOutreachDate, reEngageAttempts = 0) {
  const rule = RE_ENGAGE_RULES[stage];
  if (!rule || rule.action === 'never') return false;
  if (reEngageAttempts >= rule.maxAttempts) return false;

  if (!lastOutreachDate) return false;
  const elapsed = (Date.now() - new Date(lastOutreachDate).getTime()) / 86400000;
  return elapsed >= rule.cooldownDays;
}

// Shared inbox pool — all inboxes send to all regions.
// Inboxes are decoupled from geography; routing balances by daily send count.
// Configure these with your actual Instantly sender account emails.
// Load from env: INSTANTLY_INBOXES=inbox1@domain.com,inbox2@domain.com,...
export function getInboxPool() {
  const raw = process.env.INSTANTLY_INBOXES || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const MAX_SENDS_PER_INBOX_PER_DAY = 40; // steady state, adjust per ramp week

/**
 * Build a human-readable campaign label from batch metadata.
 * Convention: {tier}_{variant}_{testName}
 * Examples: hot_a_subject_v1, high_b_value_prop_v1, hot_c_nurture_v1
 * Used for: naming campaigns in Instantly, filtering in Twenty, reporting.
 */
export function buildCampaignLabel(tier, variant, testName) {
  const parts = [];
  if (tier) parts.push(tier.toLowerCase());
  if (variant) parts.push(variant.toUpperCase());
  if (testName) parts.push(testName.replace(/\s+/g, '_').toLowerCase());
  return parts.join('_') || '';
}

// Sending ramp — per inbox, per day
export const INBOX_COUNT = 6;
export const SENDING_RAMP = [
  { week: 1, perInbox: 30 },
  { week: 2, perInbox: 35 },
  { week: 3, perInbox: 40 }, // steady state if reply + deliverability healthy
];
export const SEND_DAYS_PER_WEEK = 5; // Mon-Fri

/**
 * Returns the recommended batch limit based on the campaign start date.
 * Week is determined by how many weeks have elapsed since startDate.
 * If no startDate provided, defaults to steady-state (week 3+).
 */
export function rampBatchLimit(startDate) {
  if (!startDate) {
    const steady = SENDING_RAMP[SENDING_RAMP.length - 1];
    return steady.perInbox * INBOX_COUNT * SEND_DAYS_PER_WEEK;
  }
  const start = new Date(startDate);
  const now = new Date();
  const weekNum = Math.floor((now - start) / (7 * 86400000)) + 1;

  const rampEntry = SENDING_RAMP.find((r) => r.week === weekNum)
    || SENDING_RAMP[SENDING_RAMP.length - 1];

  return rampEntry.perInbox * INBOX_COUNT * SEND_DAYS_PER_WEEK;
}
