import { SUPPRESSED_STAGES, COOLDOWN_DAYS, ENRICHMENT_MAX_AGE_DAYS, RE_ENGAGE_RULES, isReEngageEligible } from './constants.js';
import { toInt, hash } from './twenty-client.js';

export const STAGE_TRANSITIONS = {
  new: ['scored', 'dropped', 'bounced', 'unsubscribed'],
  scored: ['queued', 'dropped', 'bounced', 'unsubscribed'],
  queued: ['contacted', 'scored', 'dropped', 'bounced', 'unsubscribed'],
  contacted: ['opened', 'replied', 'bounced', 'unsubscribed', 'sequence_complete'],
  opened: ['replied', 'bounced', 'unsubscribed', 'opened_no_reply'],
  replied: ['replied_went_cold', 'bounced', 'unsubscribed'],
  sequence_complete: ['re_engage_ready', 'dropped', 'bounced', 'unsubscribed'],
  opened_no_reply: ['nurture', 're_engage_ready', 'dropped', 'bounced', 'unsubscribed'],
  nurture: ['nurture_complete', 'replied', 'bounced', 'unsubscribed'],
  nurture_complete: ['re_engage_ready', 'dropped', 'bounced', 'unsubscribed'],
  replied_went_cold: ['queued', 're_engage_ready', 'dropped', 'bounced', 'unsubscribed'],
  re_engage_ready: ['scored', 'dropped', 'bounced', 'unsubscribed'],
  bounced: ['dropped', 'unsubscribed'],
  unsubscribed: [],
  dropped: [],
};

export function canTransitionStage(currentStage, nextStage) {
  if (!currentStage || currentStage === nextStage) return true;
  if (nextStage === 'bounced' || nextStage === 'unsubscribed') return true;
  return (STAGE_TRANSITIONS[currentStage] || []).includes(nextStage);
}

export function getLeadMode(lead) {
  if (lead.funnel_stage === 'opened_no_reply') return 'nurture';
  if (lead.funnel_stage === 'replied_went_cold') return 'soft_followup';
  return 'first_touch';
}

export function getSuppressionReason(lead, opts = {}) {
  const mode = opts.mode || 'first_touch';
  const now = opts.now ?? Date.now();
  const region = opts.region || '';
  const minScore = opts.minScore ?? 0;
  const tierFilter = opts.tierFilter || null;
  const testName = opts.testName || '';

  if (!lead.email) return 'missing_email';
  if (region && (lead.region || '') !== region) return 'region';

  if (mode === 'first_touch') {
    if ((lead.funnel_stage || '') !== 'scored') return 'stage';
    if (toInt(lead.icp_score) < minScore) return 'min_score';
    if (tierFilter && tierFilter.length > 0) {
      const tier = (lead.icp_tier || '').toLowerCase();
      if (!tierFilter.includes(tier)) return 'tier';
    }
    if (SUPPRESSED_STAGES.includes(lead.funnel_stage)) return 'suppressed_stage';
    if (lead.last_outreach_date) {
      const lastDate = new Date(lead.last_outreach_date).getTime();
      if (!Number.isNaN(lastDate) && (now - lastDate) / 86400000 < COOLDOWN_DAYS) return 'cooldown';
    }
    if (testName && lead.ab_test_history) {
      const history = lead.ab_test_history.split(',').map((s) => s.trim()).filter(Boolean);
      if (history.includes(testName)) return 'test_dup';
    }
    if (lead.enriched_at) {
      const enrichedAt = new Date(lead.enriched_at).getTime();
      if (!Number.isNaN(enrichedAt) && (now - enrichedAt) / 86400000 > ENRICHMENT_MAX_AGE_DAYS) return 'stale_enrichment';
    }
    return null;
  }

  if (mode === 'nurture') {
    if (lead.funnel_stage !== 'opened_no_reply') return 'stage';
    if (!isReEngageEligible('opened_no_reply', lead.last_outreach_date, toInt(lead.re_engage_attempts))) return 'cooldown';
    return null;
  }

  if (mode === 'soft_followup') {
    if (lead.funnel_stage !== 'replied_went_cold') return 'stage';
    if (!isReEngageEligible('replied_went_cold', lead.last_outreach_date, toInt(lead.re_engage_attempts))) return 'cooldown';
    return null;
  }

  return 'unknown_mode';
}

export function isLeadEligible(lead, opts = {}) {
  return !getSuppressionReason(lead, opts);
}

export function assignAbVariant(email, date = new Date()) {
  const salt = date.toISOString().slice(0, 10);
  return parseInt(hash(`${email}|${salt}`).slice(0, 8), 16) % 2 === 0 ? 'A' : 'B';
}

export function nextReEngageAction(stage) {
  return RE_ENGAGE_RULES[stage]?.action || null;
}

export function isLeadRepushable(lead) {
  return ['queued', 'contacted', 'nurture'].includes(lead.funnel_stage || lead.funnelStage || '');
}
