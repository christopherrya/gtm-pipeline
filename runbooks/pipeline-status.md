# Mass Email Pipeline — Status & Handoff Guide

**Last updated:** 2026-03-05
**Branch:** `feature/email-drip-campaign`
**Status:** Infrastructure complete. Ready for data loading and first batch.

---

## What's Built

Every script in the pipeline is implemented and working. The pipeline takes real estate agent contacts from Clay CSVs through enrichment, CRM import, batch selection, Instantly campaign push, and status sync.

### Scripts

| Script | npm alias | Purpose | Status |
|--------|-----------|---------|--------|
| `scripts/lib/constants.js` | — | Funnel stages, ICP tiers, region map, re-engagement rules, inbox pool, sending ramp | Done |
| `scripts/lib/twenty-client.js` | — | Twenty CRM API client with rate limiting, pagination, batch ops | Done |
| `scripts/setup-twenty-fields.js` | `npm run setup:fields` | Create 31 custom fields on Twenty People object | Done — 31 fields confirmed |
| `scripts/setup-instantly-campaigns.js` | `npm run setup:campaigns` | Create Instantly campaigns with full email sequences | Done — 8 campaigns created as drafts |
| `scripts/select-from-pool.js` | `npm run pool:select` | Select leads from `leads/pool/` CSVs by region/tier, dedup against CRM | Done |
| `scripts/bulk-import-twenty.js` | `npm run import` | Batch import contacts + companies to Twenty CRM | Done |
| `scripts/prepare-batch.js` | `npm run batch:prepare` | Query Twenty for scored leads, assign A/B, output Instantly-ready CSV | Done |
| `scripts/push-to-instantly.js` | `npm run batch:push` | Push CSV to Instantly campaigns, write back campaign IDs to Twenty | Done |
| `scripts/sync-status.js` | `npm run batch:sync` | Poll Instantly for opens/replies/bounces, update Twenty funnel stages | Done |

### Additional npm aliases

| Alias | What it runs |
|-------|-------------|
| `npm run batch:nurture` | `prepare-batch.js --mode nurture` — select opened-no-reply contacts for Campaign C |
| `npm run batch:followup` | `prepare-batch.js --mode soft_followup` — select replied-went-cold contacts for Campaign D |

---

## Infrastructure

| System | Status | Details |
|--------|--------|---------|
| Twenty CRM | Running | Mac Mini @ `http://100.126.152.109:3000` via Tailscale |
| Twenty People fields | 31 confirmed | 15 original + 12 pipeline + 4 event timestamps |
| Instantly API | Working | v2 API, Bearer auth with `INSTANTLY_DISCLOSER_API_KEY` |
| Instantly inboxes | 6 warm | hello@getdiscloser.org, hello@usediscloser.com, hello@usediscloser.work, support@getdiscloser.org, support@usediscloser.com, support@usediscloser.work |
| Apify scraper | Running | LinkedIn/IG enrichment |

---

## CRM Data Model — Twenty People Fields (31 total)

### Core enrichment fields (15 original)

| Field | Type | Source |
|-------|------|--------|
| `icpScore` | NUMBER | Scoring engine (Clay baseline + enrichment signals) |
| `icpTier` | TEXT | Derived from icpScore: hot (90+), high (70-89), medium (55-69), low (<55) |
| `triggerScore` | NUMBER | Urgency/trigger signal score |
| `hookText` | TEXT | Personalized opening line generated from enrichment data |
| `hookVariant` | TEXT | Which hook template was used |
| `hookSource` | TEXT | What signal the hook is based on (LinkedIn post, IG activity, listing, etc.) |
| `igUsername` | TEXT | Instagram handle |
| `linkedinHeadline` | TEXT | LinkedIn profile headline |
| `linkedinDaysSincePost` | NUMBER | Days since last LinkedIn post |
| `linkedinRecentTopic` | TEXT | Topic of most recent LinkedIn post |
| `igFollowers` | NUMBER | Instagram follower count |
| `igDaysSincePost` | NUMBER | Days since last Instagram post |
| `externalLeadId` | TEXT | ID from external source (Clay, Apify) |
| `funnelStage` | TEXT | Current position in outreach funnel (see Funnel Stages below) |
| `leadSource` | TEXT | Where the lead came from (Clay, manual, referral) |

### Pipeline fields (12)

| Field | Type | Set By | Purpose |
|-------|------|--------|---------|
| `region` | TEXT | `bulk-import-twenty.js` | Geographic segment: SF Bay, LA, Sacramento, San Diego |
| `abVariant` | TEXT | `prepare-batch.js` | A or B (first touch), C (nurture), D (soft followup) |
| `lastOutreachDate` | TEXT | `push-to-instantly.js` | ISO timestamp of most recent email push (gets overwritten on each campaign) |
| `instantlyCampaignId` | TEXT | `push-to-instantly.js` | UUID of the Instantly campaign this contact is in |
| `replyToAddress` | TEXT | `push-to-instantly.js` | Unique reply-to address: `disclosure-{uuid}@inbound.discloser.co` |
| `locationRaw` | TEXT | `bulk-import-twenty.js` | Raw location string from Clay CSV before region extraction |
| `outreachStatus` | TEXT | `sync-status.js` | Instantly-level status: sent, email_opened, replied, bounced, unsubscribed |
| `assignedInbox` | TEXT | `push-to-instantly.js` | Which of the 6 sender inboxes was assigned (reused across campaigns for consistency) |
| `abTestName` | TEXT | `prepare-batch.js` | Current A/B test name (e.g. "subject_v1") |
| `abTestHistory` | TEXT | `prepare-batch.js` | Comma-separated list of all A/B tests this contact has been in |
| `campaignLabel` | TEXT | `push-to-instantly.js` | Human-readable label: `hot_A_subject_v1`, `high_B_subject_v1`, etc. |
| `reEngageAttempts` | NUMBER | `sync-status.js` | How many times this contact has been re-engaged after sequence completion |

### Event timestamp fields (4)

These record the exact moment each milestone first occurs. Once set, they are never overwritten — they capture the first occurrence only.

| Field | Type | Set By | When | Overwritten? |
|-------|------|--------|------|-------------|
| `firstContactedAt` | TEXT | `push-to-instantly.js` | First email push to Instantly (not set on nurture/followup, only first touch) | Never |
| `emailOpenedAt` | TEXT | `sync-status.js` | First time Instantly reports an open event for this contact | Never |
| `repliedAt` | TEXT | `sync-status.js` | First time Instantly reports a reply event for this contact | Never |
| `opportunityEnteredAt` | TEXT | Manual / Bucket 2 | When a replied lead is qualified and enters opportunity stage | Never |

**Why these matter:** `lastOutreachDate` gets overwritten every time a contact enters a new campaign. These timestamps don't. You can always answer "when did we first email this person?" and "how long between first contact and first reply?" without the data being lost to subsequent campaigns.

---

## End-to-End Pipeline Flow

### Step 1: CSV drops into `leads/pool/`

You export CSVs from Clay and drop them into the `leads/pool/` directory. The script accepts any CSV with these columns:

| Required | Optional (from Clay/Apify enrichment) |
|----------|--------------------------------------|
| `First Name`, `Last Name`, `Work Email` | `Company Name`, `Location`, `LinkedIn Profile`, `IG handle`, `Job Title`, `icp_score`, `icp_tier` |

You can drop multiple CSVs — the script reads all `.csv` files in the directory and deduplicates across them by email address.

### Step 2: `select-from-pool.js` picks the best leads

```bash
npm run pool:select -- --limit 500 --min-score 55
```

This script does three things:

1. **Reads every CSV** in `leads/pool/`, normalizes column names, extracts region from the location field (e.g. "San Francisco, CA" -> "SF Bay")
2. **Deduplicates against the CRM** — calls Twenty's API, loads every email already in the system, and removes matches. If you already imported Jane Smith last week, she won't be selected again.
3. **Sorts by quality** — Hot tier first, then High, then Medium, then Low. Within each tier, highest ICP score first. Takes the top N (your `--limit`).

**Output:** A CSV at `scripts/output/to_enrich_2026-03-05.csv` — these are the leads that need Apify enrichment before import.

**What hasn't happened yet:** Nothing is in the CRM. Nothing is in Instantly. These are just candidates on disk.

### Step 3: Apify enrichment (manual step)

Run the LinkedIn and Instagram enrichers on the selected CSV:

```bash
npm run enrich:linkedin
npm run enrich:instagram
```

This adds: `linkedin_headline`, `linkedin_days_since_post`, `linkedin_recent_topic`, `ig_username`, `ig_followers`, `ig_days_since_post`. These fields feed both ICP scoring and the personalization hooks used in email copy (the `{{hookText}}` merge variable in hot tier emails).

### Step 4: `bulk-import-twenty.js` loads them into the CRM

```bash
npm run import -- scripts/output/enriched_batch.csv --region "SF Bay"
```

What happens to the data:

1. **Companies created first** — extracts unique company names from the CSV (Compass, Keller Williams, etc.), checks if they already exist in Twenty, creates any missing ones. Returns a `Map<companyName, twentyId>`.

2. **People deduplication** — loads every email from Twenty into a `Map<email, twentyId>`. If a contact already exists, they go into the "update" list. If new, they go into "create."

3. **Field mapping** — each CSV row gets mapped to Twenty's People schema via `contactToTwentyPerson()`. All 31 custom fields are populated:
   - Core: name, email, phone, company link
   - Enrichment: `icpScore`, `icpTier`, `linkedinHeadline`, `igUsername`, `igFollowers`, `hookText`, etc.
   - Pipeline: `region`, `funnelStage` (set to `scored` if ICP score exists, `new` if not), `locationRaw`
   - Outreach fields left blank for now: `abVariant`, `instantlyCampaignId`, `lastOutreachDate`, timestamps, etc.

4. **Batch API calls** — creates/updates in chunks of 60 records per request, rate-limited to 100 API calls/min. 500 contacts = ~9 requests = under 10 seconds.

**After this step:** Contacts exist in Twenty CRM with `funnelStage: 'scored'`. They are NOT in Instantly. No emails have been sent. All timestamp fields are empty.

### Step 5: `prepare-batch.js` selects who to email this week

```bash
npm run batch:prepare -- --region "SF Bay" --min-score 50 --tier hot,high --test subject_v1
```

This queries the CRM, not the CSV files:

1. **Queries Twenty** for all People where `funnelStage = 'scored'`
2. **Filters** by region, minimum ICP score, and tier
3. **Suppresses** anyone already contacted, opened, replied, bounced, or unsubscribed — plus anyone within the 14-day cooldown window
4. **Prevents test duplication** — if a contact was already in the `subject_v1` test, they won't be selected again (checked via `abTestHistory` field)
5. **Assigns A/B variant** — deterministic hash of `email + date`. Roughly 50/50 split.
6. **Respects the sending ramp** — if you don't pass `--limit`, it auto-calculates based on your campaign start date: week 1 = 900/week, week 2 = 1,050/week, week 3+ = 1,200/week (6 inboxes x 40 sends/day x 5 days)

**Output:** A CSV at `scripts/output/batch_sf_bay_subject_v1_2026-03-05.csv` with columns Instantly expects: `email`, `first_name`, `last_name`, `company_name`, `hook_text`, `icp_tier`, `abVariant`, `twentyId`, etc.

**CRM update:** Selected contacts move from `funnelStage: 'scored'` -> `'queued'`. Their `abVariant` is set to `A` or `B`. The test name is written to `abTestName` and appended to `abTestHistory`.

### Step 6: `push-to-instantly.js` sends them to Instantly

```bash
npm run batch:push -- scripts/output/batch_sf_bay_subject_v1_2026-03-05.csv
```

This is where leads enter Instantly:

1. **Reads the CSV**, splits rows by `abVariant` column — A rows go to Campaign A, B rows go to Campaign B
2. **Assigns inboxes** — round-robins across the 6 warm inboxes, giving each lead to whichever inbox has the lowest send count that day. The assigned inbox is stored in Twenty so that if this contact later enters Campaign C (nurture), they get emails from the **same sender** — consistency matters for trust.
3. **Pushes to Instantly API** — `POST /api/v2/leads` with the email, name, company, and all personalization data as `custom_variables`. These map to the `{{hookText}}`, `{{firstName}}`, `{{company}}` merge variables in the email copy.
4. **Updates Twenty CRM** for each contact:
   - `funnelStage: 'contacted'`
   - `firstContactedAt: <ISO timestamp>` (only on first touch, never overwritten)
   - `lastOutreachDate: <ISO timestamp>` (overwritten on each campaign)
   - `instantlyCampaignId: <the campaign UUID>`
   - `outreachStatus: 'sent'`
   - `assignedInbox: hello@getdiscloser.org` (whichever was assigned)
   - `campaignLabel: hot_A_subject_v1`
   - `replyToAddress: disclosure-{uuid}@inbound.discloser.co`

**After this step:** Instantly has the leads and will begin sending emails on the schedule (Mon-Fri, 9-11 AM). The 4-email drip fires on day 0, +3, +8, +13. Twenty shows every contact as `contacted` with their campaign ID linked and `firstContactedAt` set.

---

## Tracking: How Instantly Status Changes Flow Back to the CRM

### `sync-status.js` — the automatic bridge

```bash
npm run batch:sync           # runs every 30 minutes in a loop
npm run batch:sync -- --once  # single run
```

This is the **only mechanism** that transfers information from Instantly back to the CRM. Here's exactly what it does:

#### 1. Load contacts from Twenty

Queries all People that have an `instantlyCampaignId` set (meaning they were pushed to Instantly).

#### 2. Poll Instantly API per campaign

Groups contacts by campaign ID, then calls `GET /api/v2/leads?campaign_id=...` for each campaign with cursor-based pagination to get every lead's current status.

#### 3. Match by email and detect status changes

For each Twenty contact, finds the corresponding Instantly lead by email address and checks their status.

#### 4. Map Instantly events to CRM funnel stages

| Instantly Event | CRM `funnelStage` | CRM `outreachStatus` | Timestamp Set |
|----------------|-------------------|---------------------|---------------|
| `email_sent` | `contacted` (already set) | `email_sent` | `firstContactedAt` (already set) |
| `email_opened` | `opened` | `email_opened` | `emailOpenedAt` (first open only) |
| `replied` | `replied` | `replied` | `repliedAt` (first reply only) |
| `bounced` | `bounced` | `bounced` | — |
| `unsubscribed` | `unsubscribed` | `unsubscribed` | — |

**Stage transitions only advance forward** — if someone is already `replied`, an `email_opened` event won't downgrade them back to `opened`. Bounces and unsubscribes override any stage.

**Timestamps are set once** — `emailOpenedAt` captures the moment of the first open. If they open 5 more emails, the timestamp doesn't change. Same for `repliedAt`. This gives you accurate time-to-engagement metrics.

#### 5. Detect sequence completions

After 14 days (the sequence duration), the sync checks contacts that are still in active stages:

| Current stage | Condition | Transitions to | Meaning |
|--------------|-----------|----------------|---------|
| `contacted` | 14+ days, never opened | `sequence_complete` | All 4 emails sent, zero opens. Subject lines didn't land. |
| `opened` | 14+ days, never replied | `opened_no_reply` | Opened at least one email but never replied. Curious but not compelled. |
| `nurture` | 10+ days since Campaign C start | `nurture_complete` | Finished the 2-email nurture sequence, still no reply. |
| `replied` | 28+ days since last outreach, no further activity | `replied_went_cold` | Replied once then went silent. |

#### 6. Detect re-engagement eligibility

Contacts in post-sequence stages are checked against cooldown timers:

| Stage | Cooldown | Next Action | Max Attempts |
|-------|----------|-------------|-------------|
| `sequence_complete` | 75 days | Re-enrich via Apify + new first touch (different subject lines, different angle) | 2 |
| `opened_no_reply` | 17 days | Campaign C (nurture) — assumes familiarity, different value prop | 1 |
| `nurture_complete` | 90 days | Re-enrich + fresh first touch (they've forgotten you by now) | 1 |
| `replied_went_cold` | 17 days | Campaign D (single soft followup: "is timing better?") | 1 |
| `bounced` | 0 days | Find alternate email via Apify. If none found, move to `dropped`. | 1 |
| `unsubscribed` | Never | Permanent removal. Never re-engage. | 0 |

When a contact's cooldown expires, sync-status moves them to `re_engage_ready`. From there, `prepare-batch.js` can pick them up in the appropriate mode.

#### 7. Batch update Twenty + print reports

All changes are applied in one batch. Then it prints:

- **Funnel snapshot** — count of contacts at each stage
- **A/B test results** — per campaign label: sent, opened, replied, bounced, open rate

---

## Leads to Opportunities: What Exists vs. What Doesn't

### What's automated now (Bucket 1)

| Capability | How it works |
|-----------|-------------|
| Track opens in CRM | `sync-status.js` polls Instantly every 30 min, sets `funnelStage: 'opened'` + `emailOpenedAt` timestamp |
| Track replies in CRM | Same sync, sets `funnelStage: 'replied'` + `repliedAt` timestamp |
| Track bounces in CRM | Same sync, sets `funnelStage: 'bounced'` |
| Track unsubscribes in CRM | Same sync, sets `funnelStage: 'unsubscribed'` |
| Re-engagement routing | `prepare-batch.js --mode nurture` and `--mode soft_followup` select the right contacts after cooldown |
| Cooldown enforcement | Suppression logic in `prepare-batch.js` prevents re-emailing too soon |
| A/B test tracking | Campaign labels + test report in `sync-status.js` show open/reply rates per variant |
| Inbox consistency | `assignedInbox` stored in Twenty, reused when contact enters Campaign C/D |
| Timestamp audit trail | `firstContactedAt`, `emailOpenedAt`, `repliedAt` — immutable, never overwritten |

### What's NOT automated yet (Bucket 2)

| Capability | Status | What would need to happen |
|-----------|--------|--------------------------|
| Converting a reply into an Opportunity object | Not built | Create Opportunity object in Twenty with its own stage progression (qualified, demo scheduled, proposal sent, closed-won, closed-lost). When `repliedAt` is set and the reply is positive, create an Opportunity linked to the Person. Set `opportunityEnteredAt` on the Person. |
| Deal stage tracking | Not built | Opportunity stages in Twenty: `qualified` -> `demo_scheduled` -> `proposal_sent` -> `negotiating` -> `closed_won` / `closed_lost` |
| Reply classification | Not built | Automatically classify replies as positive ("interested, tell me more"), negative ("not interested"), or logistical ("wrong person", "out of office"). Only positive replies become opportunities. |
| Supabase <-> Twenty sync | Not built | Bidirectional sync for inbound disclosure processing. When an agent sends back disclosures, link the inbound Supabase record to the Twenty Person/Opportunity. |

**The `opportunityEnteredAt` field is ready in the schema.** It's there for when opportunity conversion logic is built (Bucket 2), or you can set it manually in the Twenty UI when you qualify a reply today.

### Current manual workflow for replies

Until Bucket 2 is built, when a reply comes in:

1. `sync-status.js` automatically sets `funnelStage: 'replied'` and `repliedAt` in the CRM
2. You see the reply in the Instantly UI
3. You evaluate whether it's a real opportunity
4. If yes, manually set `opportunityEnteredAt` on the Person in Twenty UI
5. Track the deal stage however you prefer (notes, custom field, or wait for Bucket 2)

---

## Instantly Campaigns (all paused/draft)

### First Touch — A/B subject line test per ICP tier

| Campaign | ID | Emails | Subject line progression |
|----------|----|--------|------------------------|
| `hot_A_subject_v1` | `37fb9086-3898-4b31-9a7b-0d7a3406542d` | 4 | "quick question" -> "Chat with disclosures" -> "Cost estimates" -> "Close your file?" |
| `hot_B_subject_v1` | `93945a58-4ab1-4e33-b607-dc36ac8810ba` | 4 | "Still using ChatGPT?" -> "Between showings" -> "Know what to negotiate" -> "Not the right time?" |
| `high_A_subject_v1` | `75eec7ab-694c-40ca-87dc-5416d896f4dc` | 4 | "disclosure reviews" -> "Chat with disclosures" -> "Cost estimates" -> "Closing your file" |
| `high_B_subject_v1` | `49741a6e-91e9-4882-afaa-ec405bf8fe0b` | 4 | "Still using ChatGPT?" -> "Between showings" -> "Walk in with numbers" -> "Last note" |
| `medium_A_subject_v1` | `7aa11264-2514-4f9b-928f-d4f787fc3609` | 4 | "a disclosure tool" -> "Chat with disclosures" -> "Know what to negotiate" -> "Should I stop emailing?" |
| `medium_B_subject_v1` | `c83abf51-047f-4467-8720-b81d07ab477f` | 4 | "ChatGPT enough?" -> "Between showings" -> "Cost estimates" -> "Last note" |

### Re-engagement campaigns

| Campaign | ID | Emails | Purpose |
|----------|----|--------|---------|
| `hot_C_nurture_v1` | `3f60be37-6f3c-457d-a82e-137a7f956a09` | 2 | Nurture: opened but didn't reply. Different angle — send analysis to buyer clients. |
| `hot_D_followup_v1` | `165dc2d5-cec6-455d-a4da-89c841bb514e` | 1 | Soft followup: replied then went cold. "Is timing better now?" |

### Email copy details

- **Hot tier**: Opens with `{{hookText}}` (personalized hook from enrichment) + `{{company}}`
- **High tier**: References `{{company}}` ("agents at {{company}} do...")
- **Medium tier**: Universal, only uses `{{firstName}}`
- **All tiers**: 4-email sequence over ~14 days (day 0, +3, +5, +5). Email 1 = ChatGPT-falls-short hook. Email 2 = chat with docs / between showings. Email 3 = cost estimates / negotiation leverage. Email 4 = breakup (under 50 words).
- **Schedule**: Mon-Fri 9:00-11:00 AM, timezone `America/Creston` (UTC-7, equivalent to Pacific Daylight Time — Instantly doesn't accept `America/Los_Angeles`)
- Copy follows brand voice guidelines from `Desktop/Skills/Marketing/` — no hype words, no exclamation points, grounded in product specifics

---

## Funnel Stages

```
new -> scored -> queued -> contacted -> opened -> replied
                                     -> bounced -> dropped
                                     -> unsubscribed -> dropped

Post-sequence (detected by sync-status.js after 14 days):
  contacted (never opened)  -> sequence_complete
  opened (never replied)    -> opened_no_reply
  nurture (Campaign C done) -> nurture_complete
  replied (went silent)     -> replied_went_cold

Re-engagement (detected by sync-status.js after cooldown):
  sequence_complete   -> 75-day cooldown  -> re_engage_ready -> re-enrich -> new first touch
  opened_no_reply     -> 17-day cooldown  -> nurture (Campaign C) -> nurture_complete
  nurture_complete    -> 90-day cooldown  -> re_engage_ready -> re-enrich -> new first touch
  replied_went_cold   -> 17-day cooldown  -> soft_followup (Campaign D)
  bounced             -> immediately      -> find_alt_email -> if none found -> dropped
  unsubscribed        -> never re-engage
```

---

## Environment Variables (.env)

```bash
# CRM
CRM_PROVIDER=twenty
TWENTY_BASE_URL=http://100.126.152.109:3000
TWENTY_API_KEY=<jwt>
TWENTY_PEOPLE_METADATA_ID=1b8108be-5895-497e-832a-1c8101a06040
CRM_DRY_RUN=false
CRM_MAX_UPSERT_PER_RUN=500

# Instantly
INSTANTLY_DISCLOSER_API_KEY=<base64-encoded key>
INSTANTLY_ENABLED=false          # toggle for push-to-instantly safety
INSTANTLY_SHADOW_MODE=true       # log what would be sent without calling API
INSTANTLY_INBOXES=hello@getdiscloser.org,hello@usediscloser.com,hello@usediscloser.work,support@getdiscloser.org,support@usediscloser.com,support@usediscloser.work

# Enrichment
APIFY_API_KEY=<key>
```

---

## What Needs to Happen Next (Operational Steps)

These are sequential — each step depends on the previous one.

### 1. Drop Clay CSVs into `leads/pool/`

Place your Clay-exported CSV files in the `leads/pool/` directory. Expected columns: `First Name`, `Last Name`, `Work Email`, `Company`, `Location`, plus any enrichment columns from Clay/Apify.

### 2. Select from pool

```bash
npm run pool:select -- --region "SF Bay" --limit 500
```

This reads from `leads/pool/`, deduplicates against Twenty CRM, and outputs selected leads to `scripts/output/to_enrich_*.csv`.

### 3. Enrich via Apify (if not already enriched)

Run LinkedIn/Instagram enrichment on selected leads:

```bash
npm run enrich:linkedin
npm run enrich:instagram
```

### 4. Import to Twenty CRM

```bash
npm run import -- scripts/output/enriched_batch.csv --region "SF Bay"
```

Add `--dry-run` first to preview. Add `--limit 50` to test with a small batch.

### 5. Prepare a batch

```bash
npm run batch:prepare -- --region "SF Bay" --min-score 50 --tier hot,high --limit 200
```

Outputs a CSV to `scripts/output/` and marks selected contacts as `queued` in Twenty.

### 6. Push to Instantly

```bash
npm run batch:push -- scripts/output/batch_*.csv
```

Add `--dry-run` first. Pushes contacts to the appropriate A/B campaign based on tier and variant. Updates Twenty with campaign IDs, `contacted` stage, and `firstContactedAt` timestamp.

### 7. Start sync loop

```bash
npm run batch:sync          # runs continuously, polls every 30 min
npm run batch:sync -- --once  # run once and exit
```

Updates Twenty funnel stages and event timestamps based on Instantly events (opens, replies, bounces, unsubscribes).

### 8. Re-engagement (after sequences complete)

```bash
npm run batch:nurture       # selects opened-no-reply contacts for Campaign C
npm run batch:followup      # selects replied-went-cold contacts for Campaign D
```

Then push the output CSV with `npm run batch:push`.

---

## Key Technical Notes

### Instantly API quirks

- **Timezone**: Must use `America/Creston` (not `America/Los_Angeles`). Instantly uses a proprietary subset of IANA timezone names. Known working values: `America/Creston`, `America/Chicago`, `America/Dawson`, `America/Anchorage`, `America/Detroit`.
- **Auth**: Bearer token via `INSTANTLY_DISCLOSER_API_KEY` (base64-encoded)
- **Campaigns created paused**: Campaigns are created in draft/paused state by default. Activate manually in the Instantly UI when ready.
- **API base**: `https://api.instantly.ai/api/v2`

### Twenty CRM API

- **Auth**: Bearer JWT via `TWENTY_API_KEY`
- **Rate limit**: Scripts enforce 100 calls/min sliding window
- **Batch size**: 60 records per request for creates/updates
- **Pagination**: Cursor-based, handled by `paginateAll()` in twenty-client.js

### Sending ramp

| Week | Per inbox/day | Total/day (6 inboxes) | Weekly (Mon-Fri) |
|------|--------------|----------------------|------------------|
| 1 | 30 | 180 | 900 |
| 2 | 35 | 210 | 1,050 |
| 3+ | 40 | 240 | 1,200 |

### File structure

```
scripts/
├── lib/
│   ├── constants.js          # Shared constants, funnel stages, region map
│   └── twenty-client.js      # Twenty CRM API client
├── setup-twenty-fields.js    # One-time: create CRM fields
├── setup-instantly-campaigns.js  # Create/list Instantly campaigns
├── select-from-pool.js       # Select leads from pool CSVs
├── bulk-import-twenty.js     # Import contacts to CRM
├── prepare-batch.js          # Query CRM → output Instantly-ready CSV
├── push-to-instantly.js      # Push CSV → Instantly + update CRM
├── sync-status.js            # Poll Instantly → update CRM stages
└── output/                   # Generated batch CSVs (gitignored, contains PII)
```

### Existing campaign (pre-pipeline)

There's one pre-existing campaign `Discloser_exp_1` (ID: `fa9e48e5-b220-459c-b215-aaee9e103707`) that was created manually before this pipeline. It's separate from the 8 pipeline campaigns.

---

## Discloser Value Propositions

These are the core value props that all email copy is built on. Each email in the sequence leads with a different one.

1. **ChatGPT falls short** — Rate limits, only upload 2-3 documents at a time. By the 4th document, context is lost and answers become generic. Discloser keeps context across every document and handles bulk uploads of entire disclosure packets.

2. **Get answers between showings** — Chat with your documents and get real-time, inline citations back to the source page. Never lose context. Compare between documents. Great for reviewing between showings when you don't have time to read 200 pages.

3. **Set the stage, paint their picture** — Send the analysis to buyer clients before the showing. They get a plain-English summary with every finding ranked by severity, repair cost estimates, and exactly what to ask about during the inspection.

4. **Less time reading, more time selling** — Upload takes 2 minutes. The analysis replaces hours of manual document review.

5. **Cost estimates included** — Every finding includes estimated repair cost ranges. Foundation crack on page 47? You see a dollar range. Walk into negotiations knowing what things actually cost. Impress clients by showing up with numbers instead of guesses.

6. **Think like a real estate agent** — The product is built for how agents actually work: between showings, on mobile, under time pressure. Not a generic AI tool repurposed for real estate.

### How value props map to the email sequence

| Email | Day | Value Prop | Angle |
|-------|-----|-----------|-------|
| 1 | 0 | ChatGPT falls short | Hook — "have you tried uploading disclosures to ChatGPT?" |
| 2 | +3 | Chat with docs / between showings | Value add — "you can chat with the documents" |
| 3 | +8 | Cost estimates / negotiation leverage | Proof — "walk in with numbers instead of guesses" |
| 4 | +13 | (breakup) | Exit — under 50 words, leave the link |
| C1 | 0 | Set the stage for buyers | Different angle — "send the analysis to your buyer clients" |
| C2 | +6 | (soft close) | "If disclosure reviews aren't a pain point, fair enough" |
| D | 0 | (timing check) | "Wanted to check if the timing is better now" |

---

## Copywriting Guidelines Applied

Email copy was written using skills from `Desktop/Skills/Marketing/`:

- **Brand voice**: No hype words, no exclamation points, no "revolutionize/transform/empower". Lead with facts.
- **Taboo phrases**: Avoided "game-changer", "seamlessly", "cutting-edge", "unlock", "supercharge", etc.
- **Structure**: Short paragraphs (1-3 sentences), plain English, specific product claims, always end with `discloser.co`
- **Personalization**: Hot tier gets `{{hookText}}` (enrichment-based hook), high tier gets `{{company}}`, medium tier gets `{{firstName}}` only
- **Value props in sequence**: See table above

---

---

## What Was Done (Interest of Time)

Everything below was built in a single session on 2026-03-04/05:

1. **Shared libraries** — `constants.js` (funnel stages, ICP tiers, region map, re-engagement rules with cooldowns, sending ramp, inbox pool) and `twenty-client.js` (rate-limited API client with pagination, batch create/update, company upsert, dedup helpers). Extracted patterns from existing `orchestrator/lib/crm/twenty.js` and `orchestrator/lib/pipeline.js`.

2. **CRM field setup** — `setup-twenty-fields.js` creates all 31 custom fields on the Twenty People object. Idempotent (safe to re-run). All 31 fields confirmed created.

3. **Pool selection** — `select-from-pool.js` reads Clay CSVs from `leads/pool/`, deduplicates against CRM, sorts by ICP tier (Hot first), outputs candidates for enrichment.

4. **Bulk import** — `bulk-import-twenty.js` batch imports contacts + auto-creates companies. Handles dedup (create vs update), field mapping for all 31 fields, prints field coverage report.

5. **Batch preparation** — `prepare-batch.js` queries Twenty for scored leads, applies suppression (already contacted, cooldown window, test dedup), assigns A/B variants via deterministic hash, respects sending ramp limits, outputs Instantly-ready CSV. Supports three modes: `first_touch`, `nurture`, `soft_followup`.

6. **Instantly push** — `push-to-instantly.js` splits CSV by variant, assigns inboxes from shared pool (6 inboxes, round-robin by lowest send count), pushes to Instantly campaigns, writes back campaign IDs + timestamps to Twenty. Inbox reuse on nurture for sender consistency.

7. **Status sync** — `sync-status.js` polls Instantly every 30 min, maps events to CRM stages, sets `emailOpenedAt`/`repliedAt` timestamps on first occurrence, detects sequence completions after 14 days, detects re-engage eligibility after cooldowns, prints funnel snapshot + A/B test results table.

8. **Instantly campaigns** — `setup-instantly-campaigns.js` creates campaigns via API with full email sequences baked in. 8 campaigns created as drafts (6 first-touch A/B per tier + 1 nurture + 1 soft followup). Real copy written using brand voice skills — no placeholders.

9. **Email copy** — Absorbed copywriting skills from `Desktop/Skills/Marketing/` (brand-writer rubric, taboo phrases, voice examples, email sequence design, copy editing sweeps, plain English alternatives). Wrote tier-specific copy based on Discloser value props: ChatGPT context loss, chat with docs between showings, cost estimates for negotiation, breakup emails under 50 words. Hot tier gets `{{hookText}}` personalization, high tier gets `{{company}}`, medium is universal.

10. **Timestamp fields** — Added 4 event timestamp fields (`firstContactedAt`, `emailOpenedAt`, `repliedAt`, `opportunityEnteredAt`) that capture first occurrence only and are never overwritten. Wired into push-to-instantly and sync-status.

---

## What Needs to Happen Next

### Immediate (to start sending)

1. **Drop Clay CSVs into `leads/pool/`** — Export your 15k contacts from Clay as CSV files and place them in the `leads/pool/` directory. This is the entry point for everything.

2. **Run pool selection** — `npm run pool:select -- --limit 500 --min-score 55` to pick the first batch of best leads.

3. **Run Apify enrichment** — `npm run enrich:linkedin` and `npm run enrich:instagram` on the selected batch to populate LinkedIn/IG fields and generate hooks.

4. **Import to CRM** — `npm run import -- scripts/output/enriched_batch.csv --region "SF Bay"` (start with `--dry-run --limit 50` to verify).

5. **Review campaigns in Instantly UI** — All 8 campaigns are created as drafts. Review the email copy, adjust if needed, but do NOT activate yet.

6. **Prepare first batch** — `npm run batch:prepare -- --region "SF Bay" --min-score 70 --tier hot,high --test subject_v1 --limit 100` (start small, hot/high tier only).

7. **Push to Instantly (dry run first)** — `npm run batch:push -- scripts/output/batch_*.csv --dry-run`, review, then run without `--dry-run`.

8. **Activate campaigns in Instantly UI** — Only after push is confirmed. Emails start sending on the schedule (Mon-Fri 9-11 AM).

9. **Start sync loop** — `npm run batch:sync` to begin polling Instantly for status changes every 30 min.

### After first batch is sending (week 1-2)

10. **Monitor A/B results** — Run `npm run batch:sync -- --once --verbose` to see open/reply rates per campaign label. Determine if Variant A or B subject lines perform better.

11. **Scale up** — Increase batch sizes following the sending ramp (week 1: 900/week, week 2: 1,050/week, week 3+: 1,200/week). Add more regions.

12. **Import remaining leads** — Repeat steps 2-4 for additional batches until all 15k are in the CRM.

### After sequences complete (week 3+)

13. **Run nurture** — `npm run batch:nurture` to select opened-but-didn't-reply contacts for Campaign C, then `npm run batch:push`.

14. **Run soft followup** — `npm run batch:followup` to select replied-went-cold contacts for Campaign D, then `npm run batch:push`.

15. **Handle bounces** — Review bounced contacts in Twenty. Run Apify to find alternate emails. If found, re-import and re-queue. If not, mark as `dropped`.

### Bucket 2 (not started, depends on Bucket 1 results)

16. **Opportunity objects** — Create an Opportunity object in Twenty CRM linked to People. Stage progression: qualified -> demo_scheduled -> proposal_sent -> negotiating -> closed_won / closed_lost. Wire `opportunityEnteredAt` to be set automatically when an Opportunity is created for a Person.

17. **Reply classification** — Automatically classify replies as positive, negative, or logistical. Only positive replies create Opportunities.

18. **Supabase integration** — Connect inbound disclosure processing (Supabase edge functions) to Twenty CRM. When an agent sends back disclosures, link the Supabase record to the Twenty Person/Opportunity.

19. **Targeted listing-based outreach** — Bucket 2's main play: identify agents with active listings, reach out about specific properties, process returned disclosures through Discloser, convert engaged agents into users.

---

*This document supersedes the implementation plan sections of `runbooks/mass_email_pipeline.md` for current status. The mass_email_pipeline.md runbook remains the authoritative architecture reference.*
