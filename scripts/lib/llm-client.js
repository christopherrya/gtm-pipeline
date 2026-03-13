// LLM client — Claude API wrapper with retry, concurrency control, cost tracking
// Quality check: max 2 retries, then pattern-specific fallback

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withRetry } from './twenty-client.js';
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  parseAndValidate,
  buildCorrectionMessage,
  getFallback,
} from './prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = 'claude-sonnet-4-20250514';
const MAX_CONCURRENT = 10;
const INTER_BATCH_DELAY_MS = 100;
const RETRY_DELAYS = [5000, 20000, 60000];
const MAX_API_RETRIES = 3;   // for network/rate-limit errors
const MAX_QUALITY_RETRIES = 2; // for quality check failures (per spec)

// Cost per million tokens (Sonnet 4)
const COST_PER_M_INPUT = 3.00;
const COST_PER_M_OUTPUT = 15.00;

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in .env');
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Cost tracker
// ---------------------------------------------------------------------------

const costTracker = {
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  failures: 0,

  add(usage) {
    this.inputTokens += usage.input_tokens || 0;
    this.outputTokens += usage.output_tokens || 0;
    this.calls += 1;
  },

  get totalCost() {
    return (this.inputTokens / 1_000_000) * COST_PER_M_INPUT
      + (this.outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
  },

  summary() {
    return {
      calls: this.calls,
      failures: this.failures,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalCost: this.totalCost,
      costFormatted: `$${this.totalCost.toFixed(4)}`,
    };
  },

  reset() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
    this.failures = 0;
  },
};

export { costTracker };

// ---------------------------------------------------------------------------
// Call Claude with network-level retry
// ---------------------------------------------------------------------------

async function callClaude(messages) {
  const anthropic = getClient();
  return withRetry(async () => {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    });
    return response;
  }, MAX_API_RETRIES, RETRY_DELAYS);
}

// ---------------------------------------------------------------------------
// Personalize a single lead — with quality check retry loop
// ---------------------------------------------------------------------------

export async function personalizeLead(lead, pattern) {
  const userMessage = buildUserMessage(lead, pattern);

  let messages = [{ role: 'user', content: userMessage }];
  let lastRawOutput = '';
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
    let response;
    try {
      response = await callClaude(messages);
    } catch (err) {
      costTracker.failures += 1;
      return { success: false, method: 'fallback_error', error: err.message, pattern };
    }

    costTracker.add(response.usage);
    lastRawOutput = response.content[0]?.text || '';
    const result = parseAndValidate(lastRawOutput);

    if (result.valid) {
      return {
        success: true,
        method: 'llm',
        subject: result.parsed.subject,
        hook: result.parsed.hook,
        pattern: result.parsed.pattern,
        discloser_capability_used: result.parsed.discloser_capability_used,
        word_count: result.parsed.word_count,
      };
    }

    lastError = result.error;

    // If we have retries left, append correction and retry
    if (attempt < MAX_QUALITY_RETRIES) {
      const correction = buildCorrectionMessage(result.error);
      messages = [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: lastRawOutput },
        { role: 'user', content: correction },
      ];
    }
  }

  // All quality retries exhausted — fall back to pre-written template
  costTracker.failures += 1;
  return {
    success: false,
    method: 'fallback_validation',
    error: lastError,
    pattern,
  };
}

// ---------------------------------------------------------------------------
// Batch personalization with concurrency control
// ---------------------------------------------------------------------------

export async function personalizeBatch(eligibleLeads, maxCost = 10.0, onProgress = null) {
  costTracker.reset();
  const results = [];
  let budgetExceeded = false;

  for (let i = 0; i < eligibleLeads.length; i += MAX_CONCURRENT) {
    if (costTracker.totalCost >= maxCost) {
      budgetExceeded = true;
      break;
    }

    const chunk = eligibleLeads.slice(i, i + MAX_CONCURRENT);
    const promises = chunk.map(({ lead, pattern }) => {
      if (costTracker.totalCost >= maxCost) {
        return Promise.resolve({
          lead,
          result: { success: false, method: 'fallback_budget', error: 'budget_exceeded', pattern },
        });
      }
      return personalizeLead(lead, pattern).then((result) => ({ lead, result }));
    });

    const batchResults = await Promise.allSettled(promises);
    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        results.push({
          lead: null,
          result: { success: false, method: 'fallback_error', error: settled.reason?.message || 'unknown' },
        });
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + MAX_CONCURRENT, eligibleLeads.length), eligibleLeads.length, costTracker.summary());
    }

    if (i + MAX_CONCURRENT < eligibleLeads.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }

  // Mark remaining leads as budget-exceeded
  if (budgetExceeded) {
    const processed = results.length;
    for (let j = processed; j < eligibleLeads.length; j++) {
      results.push({
        lead: eligibleLeads[j].lead,
        result: { success: false, method: 'fallback_budget', error: 'budget_exceeded', pattern: eligibleLeads[j].pattern },
      });
    }
  }

  return { results, cost: costTracker.summary() };
}

// ---------------------------------------------------------------------------
// Estimate cost for a batch (no API calls)
// ---------------------------------------------------------------------------

export function estimateCost(eligibleCount) {
  // ~700 tokens in (larger prompt now), ~100 tokens out
  const inputTokens = eligibleCount * 700;
  const outputTokens = eligibleCount * 100;
  const cost = (inputTokens / 1_000_000) * COST_PER_M_INPUT
    + (outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
  return {
    eligibleCount,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCost: cost,
    estimatedCostFormatted: `$${cost.toFixed(4)}`,
    model: MODEL,
  };
}
