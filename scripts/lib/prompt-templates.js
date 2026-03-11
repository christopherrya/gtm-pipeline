// Prompt templates — system prompt, user prompt builder, quality checks, fallbacks
// Matches the LLM Hook Generation Prompt spec for Discloser cold email

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a cold email copywriter for Discloser, an AI tool that lets real estate agents upload entire disclosure packets and ask questions across all documents at once — with cited answers (exact page and paragraph).

Your job: generate a personalized subject line and opening hook for one real estate agent at a time.`;

// ---------------------------------------------------------------------------
// Build user message for a single lead
// ---------------------------------------------------------------------------

export function buildUserMessage(lead, pattern) {
  const parts = [];

  parts.push('Write a cold email subject line and opening hook for this real estate agent.');
  parts.push('');
  parts.push('CONTACT:');
  parts.push(`- Name: ${lead.first_name || ''} ${lead.last_name || ''}`);
  if (lead.company_name) parts.push(`- Company: ${lead.company_name}`);
  if (lead.region) parts.push(`- Region: ${lead.region}`);
  parts.push(`- ICP Tier: ${lead.icp_tier || 'unknown'}`);
  if (lead.linkedin_headline) parts.push(`- LinkedIn headline: ${lead.linkedin_headline}`);
  if (lead.linkedin_recent_topic) {
    const days = lead.linkedin_days_since_post || '?';
    parts.push(`- LinkedIn recent post: ${lead.linkedin_recent_topic} (${days} days ago)`);
  }
  if (lead.ig_username) {
    const igLine = [`@${lead.ig_username}`];
    if (lead.ig_followers) igLine.push(`${lead.ig_followers} followers`);
    parts.push(`- IG: ${igLine.join(', ')}`);
  }
  const listings = parseInt(lead.ig_listing_posts) || 0;
  const sold = parseInt(lead.ig_sold_posts) || 0;
  if (listings) parts.push(`- Active listings: ${listings}`);
  if (sold) parts.push(`- Sold: ${sold}`);
  if (lead.ig_neighborhoods) parts.push(`- Neighborhoods: ${lead.ig_neighborhoods}`);
  // propertyTypes is optional — only include if present
  if (lead.property_types) parts.push(`- Property types: ${lead.property_types}`);

  parts.push('');
  parts.push(`ASSIGNED PATTERN: ${pattern}`);

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`WHAT DISCLOSER DOES (use ONE of these capabilities in the hook):
- Upload an entire disclosure stack (TDS, SPQ, pest, NHD, inspection) and ask anything across all docs at once
- Get answers with the exact page and paragraph cited — no re-reading
- Search every document in 10 seconds — foundation, roof, permits, anything
- Pull cost estimates from disclosure findings before a showing`);

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`RULES:

Subject line:
- 21–50 characters, 2–6 words
- Never use "disclosure headaches", "disclosure packets", or "disclosure review"
- Make it sound like a text from a colleague, not a marketing email

Hook:
- Exactly 2–3 sentences
- 40 words max — count them
- Start in THEIR world. End on discloser.co.
- Always write "discloser.co" (lowercase, with .co) — never "Discloser" alone
- discloser.co must appear with one specific capability (from the list above)
- Reference neighborhoods or property types — NEVER street addresses
- No flattery. No "congrats." No "impressive." No superlatives.
- Do not use these phrases: "thick disclosure packets", "drowning in disclosures", "phone book", "hours of review", "time-consuming", "game-changer", "revolutionize"`);

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`PATTERN INSTRUCTIONS:

If Pattern A (The Moment):
Paint a scene from their actual week — in the car between showings, on the phone with a buyer's agent, at a listing appointment. Use their neighborhood and property type to make it specific. End the scene with how discloser.co changes that moment.

If Pattern B (The Peer Observation):
Reference their listing volume or market activity — not specific properties. Treat them like a peer. Frame discloser.co as what agents at their level are using. Matter-of-fact tone. No selling.

If Pattern C (The Specific Question):
Ask ONE question about their disclosure workflow that's relevant to their property type or market. The question should be interesting enough that they'd want to answer it. Follow with discloser.co as how other agents are handling it.`);

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`OUTPUT (JSON only, no commentary):
{
  "subject": "...",
  "hook": "...",
  "pattern": "A|B|C",
  "discloser_capability_used": "cited answers|full stack search|10 second search|cost estimates",
  "word_count": <number>
}`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Quality checks — run AFTER the LLM responds
// ---------------------------------------------------------------------------

const STREET_ADDRESS_RE = /\d+\s+[A-Z][a-z]+\s+(?:St|Ave|Blvd|Dr|Ln|Way|Ct|Rd|Pl|Ter)\b/;

const HOOK_BANNED_PHRASES = [
  'thick', 'drowning', 'phone book', 'congrats', 'impressive',
  'amazing', 'game-changer', 'revolutionize',
];

const SUBJECT_BANNED_PHRASES = [
  'disclosure headaches', 'disclosure packets', 'disclosure review',
];

export function parseAndValidate(rawOutput) {
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = rawOutput.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { valid: false, error: 'JSON is malformed', parsed: null };
  }

  // Check required fields
  const requiredKeys = ['subject', 'hook', 'pattern', 'discloser_capability_used', 'word_count'];
  const missingKeys = requiredKeys.filter((k) => parsed[k] === undefined || parsed[k] === null);
  if (missingKeys.length > 0) {
    return { valid: false, error: `Missing fields: ${missingKeys.join(', ')}`, parsed };
  }

  // Subject length: 21-50 chars
  if (parsed.subject.length < 21 || parsed.subject.length > 50) {
    return { valid: false, error: `Subject must be 21-50 chars (got ${parsed.subject.length})`, parsed };
  }

  // Word count: hook must be ≤ 40 words (we count ourselves, don't trust LLM count)
  const actualWordCount = parsed.hook.split(/\s+/).filter(Boolean).length;
  if (actualWordCount > 45) {
    return { valid: false, error: `Hook word count too high: ${actualWordCount} words (max 45)`, parsed };
  }

  // Street address check in hook
  if (STREET_ADDRESS_RE.test(parsed.hook)) {
    return { valid: false, error: 'Hook contains a street address', parsed };
  }

  // Banned phrases in hook
  const hookLower = parsed.hook.toLowerCase();
  for (const phrase of HOOK_BANNED_PHRASES) {
    if (hookLower.includes(phrase)) {
      return { valid: false, error: `Hook contains banned phrase: "${phrase}"`, parsed };
    }
  }

  // Banned phrases in subject
  const subjectLower = parsed.subject.toLowerCase();
  for (const phrase of SUBJECT_BANNED_PHRASES) {
    if (subjectLower.includes(phrase)) {
      return { valid: false, error: `Subject contains banned phrase: "${phrase}"`, parsed };
    }
  }

  // Hook must contain "discloser.co"
  if (!parsed.hook.toLowerCase().includes('discloser.co')) {
    return { valid: false, error: 'Hook does not contain "discloser.co"', parsed };
  }

  return { valid: true, error: null, parsed };
}

// ---------------------------------------------------------------------------
// Build correction prompt for retry
// ---------------------------------------------------------------------------

export function buildCorrectionMessage(error) {
  return `Your previous output was rejected: ${error}. Fix only this issue. Keep everything else.`;
}

// ---------------------------------------------------------------------------
// Pattern-specific fallback templates
// ---------------------------------------------------------------------------

export const FALLBACK_TEMPLATES = {
  A: {
    subject: 'Between showings?',
    hook: (lead) => {
      const neighborhoods = lead.ig_neighborhoods || lead.region || 'your area';
      const propertyTypes = lead.property_types || 'property';
      return `Next time you're heading to a ${propertyTypes} showing in ${neighborhoods} and haven't read the disclosures — pull up discloser.co, ask anything about the property, walk in with cited answers in 10 seconds.`;
    },
    pattern: 'A',
    discloser_capability_used: '10 second search',
  },
  B: {
    subject: 'Quick question for you',
    hook: (lead) => {
      const listings = parseInt(lead.ig_listing_posts) || 'several';
      return `${listings} active listings means a lot of disclosure docs. Agents at your volume are using discloser.co to search every document at once — cited answers, exact page and paragraph, no re-reading.`;
    },
    pattern: 'B',
    discloser_capability_used: 'cited answers',
  },
  C: {
    subject: 'How fast can you find it?',
    hook: () => {
      return `When a buyer's agent asks about a finding in the disclosures, how fast can you pull the exact reference? discloser.co searches every doc and cites the page. About 10 seconds.`;
    },
    pattern: 'C',
    discloser_capability_used: '10 second search',
  },
};

export function getFallback(pattern, lead) {
  const template = FALLBACK_TEMPLATES[pattern] || FALLBACK_TEMPLATES.B;
  return {
    subject: template.subject,
    hook: template.hook(lead),
    pattern: template.pattern,
    discloser_capability_used: template.discloser_capability_used,
  };
}
