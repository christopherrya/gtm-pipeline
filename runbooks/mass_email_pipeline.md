# TwentyCRM Implementation Plan — Bucket 1: Mass Outreach Pipeline

**Date:** March 4, 2026
**Status:** Active — Build Phase
**Architecture:** Twenty CRM + Instantly (two-system outbound)

---

## What This Document Covers

This plan covers **Bucket 1 only** — the mass outreach pipeline targeting real estate agents via enriched cold email through Instantly. Bucket 2 (targeted listing-based outreach with disclosure automation) is explicitly deferred until Bucket 1 is live and generating replies.

---

## Current Infrastructure Status

| System | Status | Verified |
|--------|--------|----------|
| Twenty CRM (Cloud @ `https://discloser.twenty.com`) | Running, API key generated | ✅ API tested, valid responses |
| Twenty CRM — 15 custom fields on People | Created | ✅ Confirmed in UI |
| Instantly — 6 warm inboxes | Warmed, sending | ✅ Sender reputation good |
| Instantly API access | Key exists | ❌ **NOT TESTED — must verify before build** |
| Apify scraper (LinkedIn/IG enrichment) | Running, producing data | ✅ Output available |
| Clay CSV — 15k contacts | Exported | ⚠️ Needs enrichment data merged + spot-check |
| Supabase edge functions (inbound) | Live, processing | ✅ (Not used in Bucket 1) |

### Pre-Build Blockers

**1. Test Instantly API (BLOCKING)**

Before any pipeline code is written, confirm the Instantly API works:

```bash
curl https://api.instantly.ai/api/v1/account/list?api_key=YOUR_KEY
```

Expected: JSON response listing 6 inbox accounts. If this fails, the push and sync scripts cannot function.

**2. Merge Apify enrichment into Clay CSV**

The Clay CSV has base contact data. The Apify scraper produces LinkedIn/IG enrichment (headlines, recent posts, follower counts, etc.). These need to be merged into a single import-ready CSV before bulk import. Merge key: email address or LinkedIn URL.

**3. Spot-check data quality**

Before importing 15k records, validate a sample of 50–100 rows:

- Are work emails present and properly formatted?
- Are company names consistent (e.g., "Compass" vs "Compass Real Estate" vs "compass")?
- Are ICP scores populated?
- Are location fields parseable into regions?

---

## Architecture (Bucket 1 Only)

```
Clay CSV + Apify Data
        │
        ▼
┌──────────────────────┐
│  bulk-import.js      │   Batch import 15k contacts
│  (one-time)          │   Companies created on-the-fly
└────────┬─────────────┘
         ▼
┌──────────────────────┐
│   Twenty CRM         │   Source of truth for all contacts
│   (Mac Mini)         │   People + Companies + enrichment fields
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ prepare-batch.js     │   Query by region, ICP score, tier
│                      │   Assign A/B variants, output CSV
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ personalize-batch.js │   Claude LLM personalization (Hot/High)
│                      │   A/B/C pattern rotation + fallbacks
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ push-to-instantly.js │   Push CSV to Instantly campaigns
│                      │   Write back campaign IDs + stage to Twenty
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│  sync-status.js      │   Poll Instantly for opens/replies/bounces
│  (runs on cron)      │   Update Twenty CRM funnel stages
└──────────────────────┘
```

**What is NOT in this architecture:**

- No Supabase in the outbound path
- No Opportunity objects
- No disclosure processing
- No inbound webhook handling
- No edge functions

---

## Phase 1: Schema Setup

### 1a. Add 7 New Custom Fields to People

The 15 existing fields remain. Add these 7 via `POST /api/objects/metadata/fields`:

| Field | API Name | Type | Purpose |
|-------|----------|------|---------|
| Region | `region` | TEXT | Geo segmentation (SF Bay, LA, Sacramento) |
| A/B Variant | `abVariant` | TEXT | Campaign variant assignment (A or B) |
| Last Outreach Date | `lastOutreachDate` | TEXT | Suppression/cooldown tracking |
| Instantly Campaign ID | `instantlyCampaignId` | TEXT | Links contact to Instantly campaign |
| Reply-To Address | `replyToAddress` | TEXT | `disclosure-{uuid}@inbound.discloser.co` |
| Location Raw | `locationRaw` | TEXT | Raw location string from Clay |
| Outreach Status | `outreachStatus` | TEXT | Instantly-level status (sent, opened, replied, bounced) |

### 1b. Companies

No pre-creation step. The bulk import script extracts unique company names from the Clay CSV, upserts Companies on-the-fly, and links People via the `companyId` relation.

### 1c. Funnel Stages

The `funnelStage` field on People tracks where each contact is in the outbound pipeline:

| Stage | Meaning | Set By |
|-------|---------|--------|
| `new` | Imported, not yet scored | bulk-import.js |
| `scored` | ICP scored, ready for targeting | enrichment pipeline / import |
| `queued` | Selected for outreach batch | prepare-batch.js |
| `contacted` | Email sent via Instantly | push-to-instantly.js |
| `opened` | Email opened | sync-status.js |
| `replied` | Agent replied | sync-status.js |
| `bounced` | Email bounced | sync-status.js |
| `unsubscribed` | Opted out | sync-status.js |

Note: `engaged`, `opportunity`, and `converted` stages belong to **Bucket 2** and are not implemented here.

---

## Phase 2: Shared Client Library

### `scripts/lib/twenty-client.js`

Extracted and improved from existing `gtm-pipeline/orchestrator/lib/crm/twenty.js`:

- `twentyFetch(method, path, body)` — HTTP client with Bearer auth, timeout, error handling
- `paginateAll(path, filter)` — Paginate all records, return full array
- `loadEmailIdMap()` — Load all People emails + IDs into `Map<email, id>` for fast lookups
- `batchCreate(objectName, records)` — POST batches of 60 records
- `batchUpdate(objectName, updates)` — PATCH batches by ID
- `findPersonByEmail(email)` — Single lookup with filter API
- `contactToTwentyPerson(contact)` — Field mapping (existing + new fields)
- Built-in rate limiter: max 100 calls/min

### `scripts/lib/constants.js`

- Funnel stage enum
- ICP tier thresholds: hot (90+), high (70–89), medium (55–69)
- Region mapping from raw location strings
- Instantly status → funnel stage mapping

---

## Phase 3: Bulk Import

### `scripts/bulk-import-twenty.js`

```
Usage: node bulk-import-twenty.js <clay-csv> [--region "SF Bay"] [--limit 100] [--dry-run]
```

**Flow:**

1. Read merged Clay + Apify CSV
2. Extract unique company names → batch upsert Companies → cache `{name: twentyId}`
3. Load existing People emails from Twenty → build dedup set
4. Split contacts: new (create) vs existing (update)
5. Batch create new People (60/request) with all enrichment fields + region + companyId
6. Batch update existing People with refreshed data
7. Print summary: created / updated / skipped / errors

**Performance:** 15k contacts ÷ 60 per batch = 250 requests. At ~100 req/min ≈ 3 minutes.

**Region extraction logic** (configurable in constants.js):

| Raw Location Contains | Maps To |
|----------------------|---------|
| San Francisco, Bay Area, Oakland, San Jose | SF Bay |
| Los Angeles, Beverly Hills, Santa Monica | LA |
| Sacramento, Elk Grove, Roseville | Sacramento |

---

## Phase 4: Pipeline Scripts

### 4a. `scripts/prepare-batch.js` — Select Leads from Twenty

```
Usage: node prepare-batch.js --region "SF Bay" --min-score 50 [--tier hot,high] [--limit 500]
```

**What it does:**

1. Query Twenty CRM for People where `funnelStage = 'scored'` AND `icpScore >= min-score` AND `region` matches
2. Apply suppression: exclude anyone with `funnelStage` in (`contacted`, `opened`, `replied`, `bounced`, `unsubscribed`)
3. Assign A/B variant (random split or deterministic by email hash)
4. Generate send-ready CSV with columns Instantly expects (email, first_name, last_name, custom variables for personalization)
5. Batch update selected People → `funnelStage: 'queued'`, `abVariant: 'A'` or `'B'`

### 4b. `scripts/push-to-instantly.js` — Push to Instantly + Update Twenty

```
Usage: node push-to-instantly.js <batch-csv> [--dry-run]
```

**Campaign routing:** Fetches all campaigns from the Instantly API and matches each lead to its campaign by name convention: `{tier}_{variant}_{testName}` (e.g. `hot_A_subject_v1`, `medium_C_nurture_v1`). No campaign IDs in `.env` needed.

**What it does:**

1. Fetch campaign list from Instantly → build name→ID lookup map
2. For each lead, resolve campaign from `icp_tier` + `abVariant` + `testName`
3. Group leads by resolved campaign, push each group via Instantly API
4. Warn on any unresolved leads (missing campaign in Instantly)
5. After successful push, batch update Twenty CRM for each contact:
   - `funnelStage: 'contacted'`
   - `lastOutreachDate: now()`
   - `instantlyCampaignId: <campaign_id>`
   - `assignedInbox: <sender_email>`
   - `replyToAddress: disclosure-{uuid}@inbound.discloser.co`

### 4c. `scripts/sync-status.js` — Poll Instantly → Update Twenty

```
Usage: node sync-status.js [--once] [--verbose]
```

**What it does (runs on cron, e.g., every 30 minutes):**

1. Pull lead statuses from Instantly API (opens, replies, bounces, unsubscribes)
2. Map Instantly statuses to Twenty funnel stages:

| Instantly Event | Twenty funnelStage |
|----------------|-------------------|
| email_sent | `contacted` (already set) |
| email_opened | `opened` |
| replied | `replied` |
| bounced | `bounced` |
| unsubscribed | `unsubscribed` |

3. Batch update People in Twenty CRM
4. Print funnel report (counts by stage)

---

## Phase 4b: LLM Email Personalization

### Overview

`personalize-batch.js` runs Claude Sonnet 4 to generate personalized subject lines and hooks for Hot/High ICP leads. Medium/Low leads get rule-based fallback templates.

### How It Works

1. **Eligibility gate** (`content-filter.js`): Each lead is assessed for tier (Hot/High required), enrichment data availability, recency (≤60 days), and content relevance (no political/personal/engagement farming content).

2. **Pattern assignment**: Eligible leads are assigned one of three patterns with conflict resolution:
   - **Pattern A (The Moment)** — Paints a scene from their actual workday
   - **Pattern B (The Peer Observation)** — References their listing volume, peer framing
   - **Pattern C (The Specific Question)** — Asks a specific disclosure workflow question

   Same brokerage or same LinkedIn topic can't share a pattern within a batch.

3. **Claude personalization** (`llm-client.js`): 10 concurrent API calls with quality validation (21-50 char subjects, ≤40 word hooks, must contain "discloser.co", no street addresses, banned phrases). Failed validation retries up to 2 times with correction prompts.

4. **Fallback cascade**: LLM failure → pattern-specific fallback template. Budget exceeded → all remaining leads get fallbacks. API error after 3 retries → fallback.

### Usage

```bash
# Dry run — see eligibility breakdown, pattern assignments, cost estimate
node scripts/personalize-batch.js batch.csv --dry-run

# Test mode — process only first 5 eligible leads
node scripts/personalize-batch.js batch.csv --test

# Full run (default $10 budget cap)
node scripts/personalize-batch.js batch.csv

# Custom budget
node scripts/personalize-batch.js batch.csv --max-cost 15.00
```

### Output

Writes `batch_personalized.csv` with new columns:
- `personalized_subject` — Email 1 subject line
- `personalized_hook` — Email 1 opening paragraph
- `personalization_method` — `llm`, `rule_based`, `fallback_validation`, `fallback_error`, `fallback_budget`
- `personalization_pattern` — A, B, or C
- `discloser_capability` — Which product capability the hook references
- `hook_word_count` — Word count of the generated hook

### Cost

- Model: `claude-sonnet-4-20250514`
- ~700 tokens in, ~100 tokens out per lead
- ~$0.005 per lead → ~$0.75 for 150 Hot/High leads per 500-lead batch
- Budget cap prevents runaway costs

### Configuration

Requires `ANTHROPIC_API_KEY` in `.env`.

---

## Phase 5: Environment Configuration

### `.env` additions

```
# Twenty CRM (already exists)
TWENTY_BASE_URL=https://discloser.twenty.com
TWENTY_API_KEY=<your-key>

# Instantly
INSTANTLY_API_KEY=<your-key>
INSTANTLY_CAMPAIGN_A=<campaign-id-variant-a>
INSTANTLY_CAMPAIGN_B=<campaign-id-variant-b>

# Object metadata (already known)
TWENTY_PEOPLE_METADATA_ID=93add812-8163-4b64-ac04-e75a4a86b7b9
```

### `scripts/package.json` dependencies

```json
{
  "dependencies": {
    "csv-parse": "^5.x",
    "csv-stringify": "^6.x",
    "dotenv": "^16.x"
  }
}
```

---

## Files to Create

| Action | File | Description |
|--------|------|-------------|
| Create | `scripts/lib/twenty-client.js` | Shared Twenty API client (batch, pagination, rate limit) |
| Create | `scripts/lib/constants.js` | Funnel stages, tier thresholds, region maps, status maps |
| Create | `scripts/bulk-import-twenty.js` | Batch import 15k Clay contacts to Twenty |
| Create | `scripts/prepare-batch.js` | Query Twenty for leads, assign A/B, output CSV |
| Create | `scripts/push-to-instantly.js` | Push CSV to Instantly, write back to Twenty |
| Create | `scripts/sync-status.js` | Poll Instantly, update Twenty funnel stages |
| Create | `scripts/package.json` | Dependencies |
| Modify | `.env` | Add Instantly keys + campaign IDs |
| Reuse | `orchestrator/lib/crm/twenty.js` | Extract patterns for twenty-client.js |

---

## Verification & Testing Plan

Run these in order. Every checkpoint requires **visible proof** printed to the console before moving to the next step. Do not proceed past a checkpoint if the output doesn't match expectations — fix the issue first.

---

### Checkpoint 1: Infrastructure Health

**Goal:** Confirm all APIs respond before writing any pipeline code.

| # | Test | Command | Expected Result |
|---|------|---------|-----------------|
| 1a | Twenty API health | `curl -H "Authorization: Bearer $KEY" https://discloser.twenty.com/api/objects/people?limit=1` | Valid JSON with People schema |
| 1b | Instantly API health | `curl "https://api.instantly.ai/api/v1/account/list?api_key=$KEY"` | JSON listing 6 inbox accounts |
| 1c | Twenty field creation | POST 7 new fields via API | Fields visible in Twenty UI under People settings |

**STOP. Verify in Twenty UI that all 22 fields (15 existing + 7 new) appear under People settings before proceeding.**

---

### Checkpoint 2: Apify Enrichment Validation

**Goal:** Prove that LinkedIn/IG enrichment data is accurate and properly merged before importing to Twenty.

**Required output:** The enrichment merge script must print a **sample card for 5–10 contacts** showing the raw Clay data alongside the Apify enrichment data. This lets you visually confirm the merge worked correctly.

```
═══════════════════════════════════════════════════════════
 ENRICHMENT VALIDATION — 10 Sample Contacts
═══════════════════════════════════════════════════════════

 Contact 1: Jane Smith (jane.smith@compass.com)
 ───────────────────────────────────────────────
 CLAY DATA:
   Company:          Compass Real Estate
   Location:         San Francisco, CA
   Work Email:       jane.smith@compass.com

 APIFY ENRICHMENT:
   LinkedIn Headline:    Top 1% Agent | Luxury Homes | SF Bay Area
   LinkedIn Last Post:   12 days ago
   LinkedIn Topic:       Market update on Pacific Heights pricing
   IG Username:          @janesmith_realestate
   IG Followers:         4,280
   IG Last Post:         3 days ago

 MERGE STATUS: ✅ All fields populated
═══════════════════════════════════════════════════════════

 Contact 2: Mike Johnson (mike.j@kw.com)
 ───────────────────────────────────────────────
 CLAY DATA:
   Company:          Keller Williams
   Location:         Los Angeles, CA
   Work Email:       mike.j@kw.com

 APIFY ENRICHMENT:
   LinkedIn Headline:    Realtor | Investor | KW Beverly Hills
   LinkedIn Last Post:   45 days ago
   LinkedIn Topic:       (none — no recent posts)
   IG Username:          (not found)
   IG Followers:         —
   IG Last Post:         —

 MERGE STATUS: ⚠️ Partial — IG not found
═══════════════════════════════════════════════════════════

 ... (8 more contacts)

 ENRICHMENT SUMMARY:
 ┌─────────────────────┬───────┐
 │ Metric              │ Count │
 ├─────────────────────┼───────┤
 │ Total sampled       │ 10    │
 │ Full enrichment     │ 7     │
 │ Partial (missing IG)│ 2     │
 │ Partial (missing LI)│ 1     │
 │ Failed (no match)   │ 0     │
 └─────────────────────┴───────┘
```

**What to look for:**

- LinkedIn headlines should look like real agent headlines, not garbled text
- IG usernames should be plausible handles (not null or placeholder values)
- "Days since post" should be a reasonable number (not negative, not 99999)
- Partial matches are expected — not every agent has a public IG. But if >50% are partial, the scraper may need tuning.

**STOP. Review the 10 sample cards. If enrichment data looks wrong or mostly empty, debug the Apify scraper before importing to Twenty.**

---

### Checkpoint 3: ICP Scoring Validation

**Goal:** Prove that ICP scores are calculated correctly, distributed across tiers as expected, and that the scoring logic is transparent.

**Required output:** After ICP scoring runs (either in Clay, in the enrichment pipeline, or during import), the script must print a **tier distribution report with scoring breakdown**.

```
═══════════════════════════════════════════════════════════
 ICP SCORING VALIDATION — Full Dataset
═══════════════════════════════════════════════════════════

 TIER DISTRIBUTION:
 ┌──────────┬────────┬───────────┬──────────────────────────────┐
 │ Tier     │ Range  │ Count     │ Distribution                 │
 ├──────────┼────────┼───────────┼──────────────────────────────┤
 │ 🔴 Hot   │ 90-100 │   1,240   │ ████████ 8.3%               │
 │ 🟠 High  │ 70-89  │   3,680   │ ████████████████████ 24.5%  │
 │ 🟡 Medium│ 55-69  │   5,120   │ ██████████████████████████ 34.1% │
 │ ⚪ Low   │ 0-54   │   4,960   │ █████████████████████████ 33.1% │
 ├──────────┼────────┼───────────┼──────────────────────────────┤
 │ TOTAL    │        │  15,000   │ 100%                         │
 └──────────┴────────┴───────────┴──────────────────────────────┘

 SCORING FORMULA BREAKDOWN:
 ┌──────────────────────────┬────────┬─────────────────────────────────┐
 │ Factor                   │ Weight │ How It's Calculated             │
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ LinkedIn activity        │ 25pts  │ Post in last 30d = 25,          │
 │                          │        │ 31-90d = 15, 90d+ = 5, none = 0│
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ IG presence + activity   │ 20pts  │ Has IG + active = 20,           │
 │                          │        │ Has IG + inactive = 10, none = 0│
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ Brokerage tier           │ 20pts  │ Top 10 brokerage = 20,          │
 │                          │        │ Regional = 15, Independent = 10 │
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ Email quality            │ 15pts  │ Work email = 15, personal = 5   │
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ Location match           │ 10pts  │ Target region = 10, adjacent = 5│
 ├──────────────────────────┼────────┼─────────────────────────────────┤
 │ IG follower count        │ 10pts  │ 5k+ = 10, 1k-5k = 7,           │
 │                          │        │ 500-1k = 4, <500 = 2            │
 └──────────────────────────┴────────┴─────────────────────────────────┘
 Max possible score: 100

 SAMPLE CONTACTS BY TIER (3 per tier):
 ─────────────────────────────────────

 🔴 HOT TIER (score 90+):
   • Sarah Chen (sarah@compass.com) — Score: 95
     LinkedIn: 25 (posted 4d ago) | IG: 20 (active, @sarahchen_sf) |
     Brokerage: 20 (Compass) | Email: 15 (work) | Location: 10 (SF Bay) |
     IG Followers: 5 (2,100)

   • David Park (david.park@sothebys.com) — Score: 93
     LinkedIn: 25 (posted 8d ago) | IG: 20 (active, @dparkre) |
     Brokerage: 20 (Sotheby's) | Email: 15 (work) | Location: 10 (LA) |
     IG Followers: 3 (890)

   • ... (1 more)

 🟠 HIGH TIER (score 70-89):
   • Lisa Wang (lisa.w@redfin.com) — Score: 78
     LinkedIn: 15 (posted 45d ago) | IG: 20 (active, @lisawang_homes) |
     Brokerage: 20 (Redfin) | Email: 15 (work) | Location: 5 (adjacent) |
     IG Followers: 3 (720)

   • ... (2 more)

 🟡 MEDIUM TIER (score 55-69):
   • Tom Garcia (tomg@gmail.com) — Score: 58
     LinkedIn: 15 (posted 60d ago) | IG: 10 (has IG, inactive) |
     Brokerage: 15 (regional) | Email: 5 (personal) | Location: 10 (SF Bay) |
     IG Followers: 3 (610)

   • ... (2 more)

 ⚪ LOW TIER (score 0-54):
   • Bob Miller (bob.miller@yahoo.com) — Score: 32
     LinkedIn: 0 (no profile found) | IG: 0 (none) |
     Brokerage: 15 (regional) | Email: 5 (personal) | Location: 10 (Sacramento) |
     IG Followers: 2 (n/a)

   • ... (2 more)

 SANITY CHECKS:
 ┌────────────────────────────────────────┬────────┬────────┐
 │ Check                                  │ Result │ Status │
 ├────────────────────────────────────────┼────────┼────────┤
 │ No scores below 0                     │ Pass   │ ✅     │
 │ No scores above 100                   │ Pass   │ ✅     │
 │ Hot tier < 15% of total               │ 8.3%   │ ✅     │
 │ Low tier is not majority (< 50%)      │ 33.1%  │ ✅     │
 │ Mean score is 50-75                   │ 62.4   │ ✅     │
 │ Contacts with score 0 (no data at all)│ 47     │ ⚠️     │
 └────────────────────────────────────────┴────────┴────────┘
 Note: 47 contacts with score 0 means no enrichment data was found.
 Review these — they may have bad emails or be non-agents.
```

**What to look for:**

- Hot tier should be a small, high-quality group (5–15% of total). If it's >25%, thresholds are too loose.
- Low tier should not be the majority. If >50% are low, the enrichment data may be too sparse or the scoring weights need adjustment.
- The sample contacts per tier should "make sense" — a Hot contact should clearly be a real, active, prominent agent. A Low contact should have obvious gaps (no LinkedIn, personal email, inactive).
- Zero-score contacts need investigation — these are likely bad data rows.

**STOP. Review the tier distribution and sample breakdowns. If the distribution looks wrong (e.g., 80% in one tier, or Hot tier contacts don't look like real active agents), adjust scoring weights in constants.js before proceeding to outreach.**

---

### Checkpoint 4: Bulk Import Validation

**Goal:** Confirm contacts land in Twenty CRM correctly with all fields populated.

| # | Test | Command | Expected Result |
|---|------|---------|-----------------|
| 4a | Dry run (50 contacts) | `node bulk-import-twenty.js clay_sample.csv --region "SF Bay" --limit 50 --dry-run` | Summary printed, no records created |
| 4b | Real import (50 contacts) | `node bulk-import-twenty.js clay_sample.csv --region "SF Bay" --limit 50` | 50 People in Twenty UI with all fields populated, Companies linked |
| 4c | Dedup test | Run same import again | 0 created, 50 updated, 0 duplicates |

**Required output after real import:**

```
═══════════════════════════════════════════════════════════
 IMPORT RESULTS
═══════════════════════════════════════════════════════════
 Created:   47 new People
 Updated:    3 existing People
 Skipped:    0 (no email)
 Errors:     0

 Companies created: 12 (Compass, Keller Williams, Redfin, ...)

 FIELD COVERAGE (of 50 imported):
 ┌────────────────────────┬────────┬───────┐
 │ Field                  │ Filled │ Empty │
 ├────────────────────────┼────────┼───────┤
 │ email                  │ 50     │ 0     │
 │ firstName              │ 50     │ 0     │
 │ lastName               │ 50     │ 0     │
 │ icpScore               │ 50     │ 0     │
 │ icpTier                │ 50     │ 0     │
 │ linkedinHeadline       │ 43     │ 7     │
 │ igUsername             │ 38     │ 12    │
 │ igFollowers            │ 38     │ 12    │
 │ region                 │ 50     │ 0     │
 │ funnelStage            │ 50     │ 0     │
 │ companyId (linked)     │ 48     │ 2     │
 └────────────────────────┴────────┴───────┘
```

**STOP. Open Twenty CRM UI. Click into 3–5 individual People records. Confirm that enrichment fields, ICP scores, company links, and region are all populated correctly. If fields are empty that should have data, debug the field mapping in contactToTwentyPerson().**

---

### Checkpoint 5: Pipeline Tests

**Goal:** Confirm the full outbound flow works end-to-end with a small batch.

| # | Test | Command | Expected Result |
|---|------|---------|-----------------|
| 5a | Prepare batch | `node prepare-batch.js --region "SF Bay" --min-score 50 --limit 10` | CSV generated with 10 rows, People updated to `queued` in Twenty |
| 5b | Push dry run | `node push-to-instantly.js batch.csv --dry-run` | Summary printed, no API calls to Instantly |
| 5c | Push real (10 contacts) | `node push-to-instantly.js batch.csv --campaign-a $ID --campaign-b $ID` | Contacts appear in Instantly campaign, Twenty updated to `contacted` |
| 5d | Sync test | Wait for opens/sends → `node sync-status.js --once --verbose` | Twenty People updated with `opened` / `bounced` as appropriate |

**Required output after prepare-batch:**

```
═══════════════════════════════════════════════════════════
 BATCH PREPARED — 10 contacts selected
═══════════════════════════════════════════════════════════
 Region: SF Bay | Min Score: 50 | Tier filter: all

 A/B Split:
   Variant A: 5 contacts → Campaign A
   Variant B: 5 contacts → Campaign B

 Tier breakdown of batch:
   Hot (90+):    2
   High (70-89): 5
   Medium (55-69): 3

 Suppressed (already contacted/bounced/unsub): 0
 Twenty CRM updated: 10 People → funnelStage: 'queued'
 CSV written to: batch_sf_bay_20260304.csv
```

**Required output after push:**

```
═══════════════════════════════════════════════════════════
 PUSH COMPLETE
═══════════════════════════════════════════════════════════
 Instantly Campaign A: 5 contacts added ✅
 Instantly Campaign B: 5 contacts added ✅

 Twenty CRM updates:
   funnelStage → 'contacted': 10
   lastOutreachDate set: 10
   instantlyCampaignId set: 10
   abVariant set: 10 (A: 5, B: 5)
```

**STOP. Verify in Instantly dashboard that the 10 contacts appear in the correct campaigns. Verify in Twenty CRM that those 10 People now show funnelStage = 'contacted' and have campaign IDs populated.**

---

### Checkpoint 6: Sync Validation

**Goal:** Confirm that Instantly status changes flow back to Twenty CRM correctly.

**Required output after sync-status.js runs:**

```
═══════════════════════════════════════════════════════════
 SYNC STATUS REPORT
═══════════════════════════════════════════════════════════
 Polled Instantly API: 10 leads checked
 Status changes detected: 3

 Updates applied to Twenty CRM:
   jane.smith@compass.com: contacted → opened
   david.park@sothebys.com: contacted → opened
   bob.miller@yahoo.com: contacted → bounced

 FUNNEL SNAPSHOT (all contacts):
 ┌──────────────┬───────┐
 │ Stage        │ Count │
 ├──────────────┼───────┤
 │ new          │ 0     │
 │ scored       │ 40    │
 │ queued       │ 0     │
 │ contacted    │ 7     │
 │ opened       │ 2     │
 │ replied      │ 0     │
 │ bounced      │ 1     │
 │ unsubscribed │ 0     │
 ├──────────────┼───────┤
 │ TOTAL        │ 50    │
 └──────────────┴───────┘
```

**STOP. Verify in Twenty CRM UI that the funnel stages match the sync report. Cross-check with Instantly dashboard to confirm the status mapping is correct.**

---

### Checkpoint 7: Scale Test

**Goal:** Run at production volume and confirm performance and data integrity.

| # | Test | Command | Expected Result |
|---|------|---------|-----------------|
| 7a | Full import | `node bulk-import-twenty.js full_clay.csv --region "SF Bay"` | 15k People imported in ~3 minutes |
| 7b | Full batch prepare | `node prepare-batch.js --region "SF Bay" --min-score 50 --limit 500` | 500-row CSV, all marked `queued` |
| 7c | Full push | `node push-to-instantly.js batch_500.csv` | 500 contacts in Instantly, all marked `contacted` in Twenty |
| 7d | Cron sync validation | Run sync-status.js on 30-min cron for 24 hours | Funnel stages updating correctly, no errors in logs |

**Required output after full import:**

The same field coverage table as Checkpoint 4, but for the full 15k. Pay special attention to the percentage of empty enrichment fields — if >30% of contacts are missing LinkedIn data, the Apify scraper may not have covered enough records.

**Required output after 24-hour cron sync:**

A cumulative funnel report showing the live state of all 15k contacts across all stages. This is your real-time dashboard until you build reporting in Twenty.

---

## Success Criteria

Bucket 1 is **done** when:

- [ ] 15k contacts are in Twenty CRM with all enrichment fields populated
- [ ] Contacts are segmented by region and ICP tier
- [ ] A/B campaign variants are assigned and pushing to separate Instantly campaigns
- [ ] Emails are sending from 6 warm inboxes
- [ ] sync-status.js is running on cron and updating Twenty funnel stages
- [ ] You can open Twenty CRM and see a live funnel: new → scored → queued → contacted → opened → replied
- [ ] Bounces and unsubscribes are automatically suppressed from future batches

---

## Bucket 2: Targeted Listing-Based Outreach (DEFERRED)

### What It Is

Bucket 2 is a separate, more targeted outreach strategy focused on agents with active listings at major brokerages. Instead of mass cold email, this workflow:

1. Identifies agents with specific active listings
2. Reaches out asking about the property / requesting disclosures
3. When agents send disclosures back, PDFs are automatically ingested
4. The Discloser product processes, summarizes, and surfaces findings
5. Agents who engage become onboarding opportunities

### Why It's Deferred

- It requires the full Supabase inbound pipeline (edge functions, PDF webhooks, review queue, agent onboarding flow)
- It introduces Opportunity objects in Twenty CRM with their own stage progression
- It adds bidirectional sync complexity (Supabase ↔ Twenty)
- The disclosure product processing pipeline needs to be rock-solid before connecting it to outreach

### What Stays Live

Supabase edge functions for inbound processing remain deployed and running. They are not being modified or removed. When Bucket 2 begins, the integration point will be connecting the inbound Supabase pipeline to Twenty CRM for Opportunity tracking and advanced funnel stages (`engaged`, `opportunity`, `converted`).

### When to Start Bucket 2

After Bucket 1 meets all success criteria AND:

- Replies are flowing and you have data on response rates
- A/B test results inform which messaging works for targeted outreach
- The disclosure product is stable and tested independently

---

## Technical Tradeoffs

### Decision: Twenty CRM over SuiteCRM

**What we gain:**

- Modern, clean UI built on React — agents and ops staff can actually use it without training
- Custom objects and relations are first-class — the real estate data model (People ↔ Properties ↔ Transactions) fits naturally instead of being forced into rigid modules
- REST API with batch endpoints — Claude Code can manage the entire CRM programmatically, which is the core of the strategy
- Open source with self-hosted option — no vendor lock-in on contact data, no per-contact pricing surprises at scale
- GraphQL + REST dual API — flexibility for both simple scripts and complex queries

**What we lose:**

- SuiteCRM has years of built-in workflow automation, reporting, and email marketing features that Twenty doesn't have yet. We're trading mature but ugly for modern but young.
- Twenty's ecosystem is smaller — fewer community plugins, fewer integrations out of the box. Anything we need, we build ourselves (or Claude Code builds).
- Twenty is early-stage software (YC-backed, 28k GitHub stars, but still pre-1.0 in maturity). There's a risk of breaking changes in API or schema between versions.
- Migration effort: the 15 custom fields already created have to be maintained manually. If Twenty changes its metadata API, field definitions could break.

**Why the tradeoff is worth it:** The entire thesis is that Claude Code is the automation layer. We don't need SuiteCRM's built-in workflows because Claude Code replaces them. What we need is a clean API and a flexible data model — and Twenty delivers that better than SuiteCRM does.

---

### Decision: Two-System Architecture (Twenty + Instantly) vs Three-System (+ Supabase)

**What we gain by dropping Supabase from outbound:**

- One fewer system to sync — eliminates an entire class of "data got out of sync" bugs
- Simpler mental model: contacts live in Twenty, emails go through Instantly, status syncs back to Twenty. That's it.
- Faster build time — no Supabase migration, no `twenty_person_id` columns, no bidirectional sync bridges
- Fewer points of failure in the pipeline — if sync-status.js fails, you only have two systems to debug, not three

**What we lose:**

- No campaign-level logging in Supabase — if you later want SQL-queryable analytics on outreach campaigns (open rates by region, reply rates by ICP tier over time), you'll need to either query Twenty's API or build a reporting layer
- No backup data store — if Twenty goes down or corrupts, there's no Supabase mirror of outbound campaign state. Instantly itself becomes the backup (it has its own lead status tracking).
- When Bucket 2 launches, Supabase re-enters the picture anyway for inbound processing. At that point, you may want campaign data in Supabase for joins against inbound data. Retrofitting the outbound → Supabase logging is more work later than building it now.

**Why the tradeoff is worth it:** Speed to market. Getting 15k emails out the door through a clean two-system pipeline is more valuable than architectural completeness. The Supabase integration can be added as a non-blocking enhancement later — it doesn't gate any Bucket 1 functionality.

---

### Decision: Batch API Calls (60/request) vs Serial Upserts

**What we gain:**

- 15k contacts import in ~3 minutes instead of 5+ hours
- Sustainable rate of ~100 API calls/min stays well within Twenty's limits
- Batch updates on sync mean funnel stages update in seconds, not minutes

**What we lose:**

- Batch failures are harder to debug — if 1 of 60 records in a batch has bad data, the whole batch may fail depending on Twenty's error handling. Serial upserts give you per-record error granularity.
- Partial batch failures can leave data in an inconsistent state — 30 of 60 records created, then an error. The script needs retry logic with dedup protection.

**Mitigation:** The bulk import script includes a dedup check (load existing emails first, skip known records). The twenty-client.js library should log failed batches with the specific records that failed, so they can be retried individually.

---

### Decision: Polling Instantly (sync-status.js on cron) vs Webhooks

**What we gain:**

- Simpler infrastructure — no public endpoint needed, no webhook receiver to host and secure
- Works from behind NAT / on Mac Mini without port forwarding
- Predictable execution: runs every 30 minutes, processes whatever's new

**What we lose:**

- Latency: up to 30 minutes between an agent replying and Twenty CRM reflecting the reply. For mass outreach this is fine. For Bucket 2 (targeted, time-sensitive outreach), it may not be.
- Wasted API calls: polling checks everything even when nothing changed. At 15k contacts this is manageable; at 100k+ it could hit Instantly's rate limits.
- No real-time reactivity — you can't trigger an immediate action (like a Slack notification) when a high-value lead replies. You'd know 30 minutes later.

**Why the tradeoff is worth it:** For Bucket 1 (mass outreach), 30-minute latency is perfectly acceptable. Real-time webhook integration can be added for Bucket 2 when individual lead responses are more time-sensitive and the infrastructure (public endpoint, SSL, webhook verification) is justified.

---

### Decision: Self-Hosted Twenty on Mac Mini vs Cloud-Hosted

**What we gain:**

- Zero per-contact costs — 15k now, 30k soon, potentially 100k+ later. All unlimited.
- Full database access — can run raw Postgres queries for reporting, bulk operations, or emergency fixes
- No API rate limit anxiety — it's your server, your rules
- Data sovereignty — all contact data stays on your hardware

**What we lose:**

- Uptime depends on your Mac Mini and network — if the machine sleeps, loses power, or your Tailscale node goes offline, the CRM is down
- No automatic backups unless you set them up (pg_dump on cron)
- No automatic updates — you're responsible for pulling new Twenty releases and migrating
- Single point of failure — no redundancy, no failover

**Mitigation:** Set up a daily pg_dump backup to an external location (S3, another machine, or even a mounted drive). Ensure the Mac Mini is configured to never sleep and auto-restart after power loss. Consider moving to a small cloud VM (Hetzner, Railway) if uptime becomes critical.

---

### Risk: Twenty CRM Is Young Software

Twenty is backed by Y Combinator, has 28k+ GitHub stars, and was built by a team that previously sold to Airbnb. But it's still early-stage. Specific risks:

- **API breaking changes**: A schema or endpoint change in a Twenty update could break all pipeline scripts. Pin to a specific version and test before upgrading.
- **Feature gaps**: Advanced reporting, workflow automation, and email marketing features that HubSpot or SuiteCRM have out of the box don't exist in Twenty. You're building them yourself via Claude Code.
- **Community size**: Fewer StackOverflow answers, fewer blog posts, fewer third-party integrations. When you hit a bug, you may be filing a GitHub issue rather than finding a solution.
- **Performance at scale**: Twenty is tested by its cloud users, but self-hosted performance with 30k+ records and heavy API usage may surface issues that cloud users don't hit. Monitor query times and API response latency as data grows.

**Why we accept this risk:** The alternative (SuiteCRM) has proven that mature-but-rigid doesn't work for this use case. Twenty's API-first, custom-object architecture is fundamentally better suited to what we're building. The risks are manageable with version pinning, backups, and Claude Code's ability to adapt quickly if the API changes.

---

*This document is the authoritative spec for Bucket 1. Any previous plans that include Supabase in the outbound pipeline, Opportunity objects, or disclosure processing are superseded by this document for the current build phase.*