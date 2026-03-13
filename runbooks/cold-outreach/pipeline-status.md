# Mass Email Pipeline — Status & Handoff Guide

**Last updated:** 2026-03-11
**Branch:** `main`
**Status:** Live. 1,052 leads active across all 8 campaigns (hot/high/medium/low). Automated weekly pipeline active.

---

## What's Built

Every script in the pipeline is implemented and working. The pipeline takes real estate agent contacts from Clay CSVs through enrichment, CRM import, batch selection, Instantly campaign push, and status sync.

### Scripts

| Script | npm alias | Purpose | Status |
|--------|-----------|---------|--------|
| `scripts/lib/constants.js` | — | Funnel stages, ICP tiers, region map, re-engagement rules, inbox pool, sending ramp | Done |
| `scripts/lib/twenty-client.js` | — | Twenty CRM API client with rate limiting, pagination, batch ops | Done |
| `scripts/setup-twenty-fields.js` | `npm run setup:fields` | Create 36 custom fields on Twenty People object | Done — 36 fields confirmed |
| `scripts/setup-instantly-campaigns.js` | `npm run setup:campaigns` | Create Instantly campaigns with full email sequences | Done — 8 campaigns created, all active |
| `scripts/select-from-pool.js` | `npm run pool:select` | Select leads from `~/Desktop/Discloser_Leads/` by tier, dedup against CRM | Done |
| `scripts/run-pipeline.js` | `npm run pipeline` | Full pipeline runner: select → enrich → import → prepare → personalize → push | Done |
| `scripts/install-launchd.js` | — | Install macOS launchd plists for automated scheduling | Done |
| `scripts/bulk-import-twenty.js` | `npm run import` | Batch import contacts + companies to Twenty CRM | Done |
| `scripts/prepare-batch.js` | `npm run batch:prepare` | Query Twenty for scored leads, assign A/B, output Instantly-ready CSV | Done |
| `scripts/push-to-instantly.js` | `npm run batch:push` | Push CSV to Instantly campaigns, write back campaign IDs to Twenty | Done |
| `scripts/sync-status.js` | `npm run batch:sync` | Poll Instantly for opens/replies/bounces, update Twenty funnel stages | Done |
| `scripts/reset-queued-leads.js` | `npm run leads:reset-queued` | Recover leads stuck as `queued` with no `instantlyCampaignId` — resets to `scored` | Done |

### Additional npm aliases

| Alias | What it runs |
|-------|-------------|
| `npm run batch:nurture` | `prepare-batch.js --mode nurture` — select opened-no-reply contacts for Campaign C |
| `npm run batch:followup` | `prepare-batch.js --mode soft_followup` — select replied-went-cold contacts for Campaign D |
| `npm run leads:reset-queued:dry` | `reset-queued-leads.js --dry-run` — preview stuck leads before resetting |
| `npm run leads:reset-queued` | `reset-queued-leads.js --yes` — reset stuck leads back to scored |

---

## Infrastructure

| System | Status | Details |
|--------|--------|---------|
| Twenty CRM | Running | Cloud @ `https://discloser.twenty.com` (Twenty hosted) |
| Twenty People fields | 36 confirmed | 15 original + 12 pipeline + 4 IG enrichment + 5 event timestamps (incl. `enrichedAt`) |
| Instantly API | Working | v2 API, Bearer auth with `INSTANTLY_DISCLOSER_API_KEY` |
| Instantly inboxes | 6 warm | hello@getdiscloser.org, hello@usediscloser.com, hello@usediscloser.work, support@getdiscloser.org, support@usediscloser.com, support@usediscloser.work |
| Apify scraper | Running | LinkedIn/IG enrichment |

---

## Automated Weekly Pipeline

The pipeline runs automatically every Monday at 6:00 AM via macOS launchd. No manual intervention required.

### What happens Monday 6am

```
select-from-pool.js     Read ~/Desktop/Discloser_Leads/*.csv
        │                Dedup against CRM (skip anyone already imported)
        │                Pick top 500 by ICP score across all regions
        ▼
enrich-leads.js         LinkedIn enrichment via Apify (harvestapi/linkedin-profile-posts)
        │                Instagram enrichment via Apify (sones/instagram-posts-scraper-lowcost)
        │                ICP scoring + hook generation
        ▼
bulk-import-twenty.js   Import enriched leads into Twenty CRM
        │                Create companies, set funnelStage: 'scored'
        ▼
prepare-batch.js        Filter scored contacts, assign A/B variants
        │                Output Instantly-ready CSV
        ▼
personalize-batch.js    Claude LLM personalization for Hot/High tier
        ▼
push-to-instantly.js    Push to Instantly campaigns
                         Update CRM: funnelStage: 'contacted'
```

Emails start sending the same morning as Instantly picks up the queue (Mon-Fri, 9-11 AM).

### Launchd schedules

| Plist | Label | Schedule | Command |
|-------|-------|----------|---------|
| Pipeline | `com.discloser.gtm.pipeline` | Monday 6:00 AM | `run-pipeline.js --full --auto` |
| Sync | `com.discloser.gtm.sync` | Every 30 minutes | `sync-status.js --once` |

### Lead pool

Lead CSVs live at `~/Desktop/Discloser_Leads/` (configured via `LEAD_POOL_DIR` in `.env`):

| File | Leads |
|------|-------|
| `Raw_Clay_SanDiego.csv` | ~4,987 |
| `Raw_Clay_SanFrancisco.csv` | ~4,781 |
| `Raw_Clay_SouthBay.csv` | ~3,121 |
| **Total** | **~12,889** |

At 500/week, this pool lasts ~25 weeks. No region filter — the best leads across all regions are selected each week. Leads already imported to the CRM are automatically skipped.

### Manual commands

```bash
# Full pipeline (same as Monday automation)
node scripts/run-pipeline.js --full --auto

# Full pipeline, dry run
node scripts/run-pipeline.js --full --auto --dry-run

# Full pipeline, specific region only
node scripts/run-pipeline.js --full --auto --region "San Diego"

# Downstream only (prepare → personalize → push, reads from CRM)
node scripts/run-pipeline.js --region "SF Bay" --auto

# Resume a failed run
node scripts/run-pipeline.js --resume <runId> --from-step enrich

# Check launchd status
node scripts/install-launchd.js --status

# Reinstall/update launchd plists
node scripts/install-launchd.js

# Uninstall launchd plists
node scripts/install-launchd.js --uninstall
```

### Logs

```
scripts/logs/launchd-pipeline.log    # Pipeline stdout
scripts/logs/launchd-pipeline.err    # Pipeline stderr
scripts/logs/launchd-sync.log        # Sync stdout
scripts/logs/launchd-sync.err        # Sync stderr
scripts/logs/runs/<runId>/           # Per-run structured logs
```

### run-pipeline.js flags

| Flag | Default | Description |
|------|---------|-------------|
| `--full` | off | Include upstream steps (select → enrich → import) |
| `--auto` | off | Skip approval gate before push |
| `--region <name>` | all regions | Filter by region (optional with `--full`) |
| `--select-limit N` | 500 | Max leads to select from pool |
| `--min-score N` | 55 | Min ICP score for pool selection |
| `--test <name>` | none | A/B test name (e.g. `subject_v1`) |
| `--mode <mode>` | first_touch | `first_touch`, `nurture`, or `soft_followup` |
| `--skip-personalize` | off | Skip LLM personalization step |
| `--dry-run` | off | No API calls, no file writes |
| `--max-cost N` | 10.00 | Budget cap for LLM personalization |

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

### Event timestamp fields (5)

These record the exact moment each milestone first occurs. Once set, they are never overwritten — they capture the first occurrence only.

| Field | Type | Set By | When | Overwritten? |
|-------|------|--------|------|-------------|
| `enrichedAt` | TEXT | `bulk-import-twenty.js` | Set to `linkedin_enriched_at` from CSV, falls back to import timestamp. Used by `prepare-batch.js` to enforce the 2-day freshness gate — leads enriched more than 2 days ago are skipped until re-enriched. | On every import/re-import |
| `firstContactedAt` | TEXT | `push-to-instantly.js` | First email push to Instantly (not set on nurture/followup, only first touch) | Never |
| `emailOpenedAt` | TEXT | `sync-status.js` | First time Instantly reports an open event for this contact | Never |
| `repliedAt` | TEXT | `sync-status.js` | First time Instantly reports a reply event for this contact | Never |
| `opportunityEnteredAt` | TEXT | Manual / Bucket 2 | When a replied lead is qualified and enters opportunity stage | Never |

**Why these matter:** `lastOutreachDate` gets overwritten every time a contact enters a new campaign. These timestamps don't. You can always answer "when did we first email this person?" and "how long between first contact and first reply?" without the data being lost to subsequent campaigns.

---

## End-to-End Pipeline Flow

### Step 1: CSV drops into `~/Desktop/Discloser_Leads/`

You export CSVs from Clay and drop them into `~/Desktop/Discloser_Leads/` (or whatever `LEAD_POOL_DIR` points to in `.env`). The script accepts any CSV with these columns:

| Required | Optional (from Clay/Apify enrichment) |
|----------|--------------------------------------|
| `First Name`, `Last Name`, `Work Email` | `Company Name`, `Location`, `LinkedIn Profile`, `IG handle`, `Job Title`, `icp_score`, `icp_tier` |

You can drop multiple CSVs — the script reads all `.csv` files in the directory and deduplicates across them by email address. Currently contains ~12,889 leads across San Diego, San Francisco, and South Bay.

### Step 2: `select-from-pool.js` picks the best leads

```bash
npm run pool:select -- --limit 500 --min-score 55
```

This script does four things:

1. **Reads every CSV** in `leads/pool/`, normalizes column names, extracts region from the location field (e.g. "San Francisco, CA" -> "SF Bay")
2. **Deduplicates against the CRM** — calls Twenty's API, loads every email already in the system, and removes matches. If you already imported Jane Smith last week, she won't be selected again.
3. **Sorts by quality** — Hot tier first, then High, then Medium, then Low. Within each tier, highest ICP score first. Takes the top N (your `--limit`).
4. **Company spacing** — Only one lead per company per batch. If 3 agents at Keller Williams are in the candidate pool, the highest-scored one goes in this batch and the other 2 are deferred to future batches. This prevents flooding the same brokerage's inbox and looking spammy. Leads without a company name always pass through.

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
npm run batch:push -- scripts/output/batch_sf_bay_subject_v1_2026-03-05.csv --test subject_v1
```

> **Important:** Always pass `--test <testName>` when running push directly (not via `run-pipeline.js`). The push script resolves campaign names using the tier + variant + testName convention (e.g. `hot_A_subject_v1`). If the batch CSV has no `testName` column — which happens when `prepare-batch.js` is run without `--test` — the script cannot find the campaigns without this flag.

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

## Instantly Campaigns (all active)

### First Touch — A/B subject line test per ICP tier

| Campaign | ID | Emails | Value Prop Angle |
|----------|----|--------|-----------------|
| `hot_A_subject_v1` | `d54e3206-540f-43c7-b706-7390a3415b1f` | 4 | **A: ChatGPT comparison** — "tried ChatGPT?" -> chat with docs -> cost estimates -> breakup |
| `hot_B_subject_v1` | `e9d8e840-cb2f-4304-b0f2-bffadd64360d` | 4 | **B: Speed + costs** — "247 pages in 3 min" -> full packet upload -> chat with docs -> breakup |
| `high_A_subject_v1` | `24d3a419-a603-48b4-a825-153946196121` | 4 | **A: ChatGPT comparison** — "upload to ChatGPT?" -> chat with docs -> cost estimates -> breakup |
| `high_B_subject_v1` | `48ed281c-3d63-4f65-bf4a-660807767816` | 4 | **B: Speed + costs** — "3 min, cost estimates" -> full packet upload -> chat with docs -> breakup |
| `medium_A_subject_v1` | `fe28a9db-86d1-4904-b811-f8bd00dab7c8` | 4 | **A: ChatGPT comparison** — "ChatGPT loses context" -> chat with docs -> cost estimates -> breakup |
| `medium_B_subject_v1` | `ff4aeff6-b485-47a9-ba24-52b044dd8a6c` | 4 | **B: Speed + costs** — "247 pages, cost estimates" -> full packet upload -> chat with docs -> breakup |

### Re-engagement campaigns

| Campaign | ID | Emails | Purpose |
|----------|----|--------|---------|
| `hot_C_nurture_v1` | `38048816-95fe-4504-80b7-73e67849bf2f` | 2 | Nurture: opened but didn't reply. Different angle — send analysis to buyer clients. |
| `hot_D_followup_v1` | `bccb5068-a886-4709-88d7-8e4f45c85dd0` | 1 | Soft followup: replied then went cold. "Is timing better now?" |

### Email copy details

- **Hot tier**: Opens with `{{hookText}}` (personalized hook from enrichment) + `{{company}}`
- **High tier**: References `{{company}}` ("agents at {{company}} do...")
- **Medium tier**: Universal, only uses `{{firstName}}`
- **All tiers**: 4-email sequence over ~14 days (day 0, +3, +5, +5). Email 1 = ChatGPT-falls-short hook. Email 2 = chat with docs / between showings. Email 3 = cost estimates / negotiation leverage. Email 4 = direct breakup (action-oriented, no passive language).
- **Signature**: All emails include a plain-text footer via `{{sender_name}}` merge variable — resolves to the sender persona (Lauri Parker or Jesslyn Rose) per inbox.
- **Schedule**: Mon-Fri 9:00-11:00 AM, timezone `America/Creston` (UTC-7, equivalent to Pacific Daylight Time — Instantly doesn't accept `America/Los_Angeles`)
- Copy follows brand voice guidelines — no hype words, no exclamation points, no passive language ("I'll just leave this here"), grounded in product specifics

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
TWENTY_BASE_URL=https://discloser.twenty.com
TWENTY_API_KEY=<jwt>
TWENTY_PEOPLE_METADATA_ID=93add812-8163-4b64-ac04-e75a4a86b7b9
CRM_DRY_RUN=false
CRM_MAX_UPSERT_PER_RUN=500

# Instantly
INSTANTLY_API_KEY=<base64-encoded key>
INSTANTLY_ENABLED=true           # set to false to block all Instantly API calls
INSTANTLY_SHADOW_MODE=false      # set to true to run push in dry-run mode (logs routing, no API calls)
INSTANTLY_INBOXES=hello@getdiscloser.org,hello@usediscloser.com,hello@usediscloser.work,support@getdiscloser.org,support@usediscloser.com,support@usediscloser.work
# Note: Campaign IDs are auto-resolved from Instantly API by name convention (no INSTANTLY_CAMPAIGN_* vars needed)

# Enrichment
APIFY_API_KEY=<key>

# Pipeline config
CAMPAIGN_START_DATE=2026-03-10   # Used by prepare-batch.js to calculate ramp week and enforce weekly send limits
                                  # Week 1=900/wk, Week 2=1050/wk, Week 3+=1200/wk. Update if you restart the ramp.
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
│   ├── twenty-client.js      # Twenty CRM API client
│   ├── logger.js             # Structured JSON logging
│   ├── mailer.js             # Email notifications on failure/completion
│   └── run-tracker.js        # Per-run state tracking (artifacts, steps, timing)
├── run-pipeline.js           # Full pipeline runner (--full for all 6 steps)
├── install-launchd.js        # Install/uninstall macOS launchd scheduling
├── setup-twenty-fields.js    # One-time: create CRM fields
├── setup-instantly-campaigns.js  # Create/list Instantly campaigns
├── select-from-pool.js       # Select leads from ~/Desktop/Discloser_Leads/
├── bulk-import-twenty.js     # Import contacts to CRM
├── prepare-batch.js          # Query CRM → output Instantly-ready CSV
├── personalize-batch.js      # Claude LLM personalization for Hot/High tier
├── push-to-instantly.js      # Push CSV → Instantly + update CRM
├── sync-status.js            # Poll Instantly → update CRM stages
├── output/                   # Generated batch CSVs (gitignored, contains PII)
└── logs/                     # Launchd + per-run logs

enrichment/
├── enrich-leads.js           # Master enrichment pipeline (LinkedIn + IG + ICP + hooks)
├── linkedin-enricher.js      # LinkedIn enrichment via Apify
├── instagram-enricher.js     # Instagram enrichment via Apify
└── ...

~/Desktop/Discloser_Leads/    # Lead pool (Clay CSVs, outside repo)
├── Raw_Clay_SanDiego.csv
├── Raw_Clay_SanFrancisco.csv
└── Raw_Clay_SouthBay.csv
```

### Existing campaign (pre-pipeline)

There's one pre-existing campaign `Discloser_exp_1` (ID: `fa9e48e5-b220-459c-b215-aaee9e103707`) that was created manually before this pipeline. It's separate from the 8 pipeline campaigns.

---

## Enrichment Freshness Policy

**Rule:** Leads must be enriched within 2 days of being pushed to Instantly. This is enforced in `prepare-batch.js` via the `enrichedAt` field.

**Why this matters:** Email personalization pulls from live enrichment data — LinkedIn recent post topics, Instagram activity, hook text. Stale data produces generic or incorrect personalizations. More critically, the `{{hookText}}` merge variable in hot/high tier emails references specific recent activity. If enrichment is a week old, that activity may no longer be recent enough to feel genuine.

**How it works:**
1. `bulk-import-twenty.js` sets `enrichedAt` on every create/update (from `linkedin_enriched_at` in CSV, or falls back to import timestamp)
2. `prepare-batch.js` filters out any lead where `enrichedAt` is older than `ENRICHMENT_MAX_AGE_DAYS` (2)
3. Stale leads remain at `funnelStage: 'scored'` — they are NOT moved to `queued`. They will be re-enriched the next time a full pipeline run picks them up
4. Legacy leads (imported before `enrichedAt` existed) have no value in this field — they pass through the check to avoid breaking existing data

**Consequence of stale leads reaching Instantly:** The main risk is not deliverability, it's relevance. A hook referencing a LinkedIn post from 2 weeks ago reads as stale to the recipient. The 2-day window ensures the enrichment data is close enough to the send date to feel timely.

---

## Sending Rate & Capacity

The pipeline enforces a sending ramp via `CAMPAIGN_START_DATE` in `.env`. The ramp limit is auto-calculated each time `prepare-batch.js` runs.

| Week | Per inbox/day | 6 inboxes × 5 days | Weekly cap |
|------|--------------|---------------------|------------|
| 1 | 30 | | 900 |
| 2 | 35 | | 1,050 |
| 3+ | 40 | | 1,200 |

**The ramp cap is a batch-level limit**, not a per-day limit. It limits how many leads `prepare-batch.js` queues in a single Monday run. Instantly still needs its own per-inbox daily send limits configured in **Instantly → Email Accounts → each inbox → Daily sending limit** — match these to the ramp table above. Without this, Instantly will send all queued leads as fast as possible regardless of the batch cap.

**Campaign start date** (`CAMPAIGN_START_DATE=2026-03-10` in `.env`): this is the reference point for week calculation. If you pause the campaign for a week and want to restart the ramp, update this date.

---

## Incident Log

### 2026-03-11 — Leads not sending; hot/high/medium campaigns empty

**What happened:** No emails went out the morning of 2026-03-11 despite all campaigns being active. Investigation found two compounding issues:

**Root cause 1 — Campaigns had no sending accounts connected.**
Campaigns were created via the Instantly API (`setup-instantly-campaigns.js`) but the API does not automatically attach sending accounts (inboxes) to campaigns. Inboxes must be connected manually in the Instantly UI under each campaign's settings. This was an undocumented requirement.
*Resolution:* Manually connected all 6 inboxes to all 8 campaigns in the Instantly UI.

**Root cause 2 — 707 hot/high/medium leads permanently stuck as `queued`.**
During the March 10 pipeline run, `prepare-batch.js` marked 1,054 leads as `queued` and wrote them to a CSV, but the push step aborted before running. The pipeline was re-run, but by then those 1,054 leads were in `queued` state — invisible to the weekly pipeline, which only queries `funnelStage: 'scored'`. Of the 1,054 stuck leads, 345 low-tier ones were eventually caught and pushed in a later run; the remaining 709 hot/high/medium leads had no `instantlyCampaignId` and were silently skipped forever.
*Resolution:* Built `reset-queued-leads.js` to identify leads stuck as `queued` with no `instantlyCampaignId` and reset them to `scored`. 707 leads recovered and pushed same day.

**Why the queue-without-push scenario is dangerous:** `prepare-batch.js` marks leads as `queued` *before* the push runs. If the push fails for any reason, those leads are in a terminal state — the pipeline won't touch them again and there's no automatic recovery. The `reset-queued-leads.js` script is the manual recovery tool for this scenario.

---

### Bug log (fixed 2026-03-11)

**Bug 1: `sync-status.js` crashing every 30 minutes**
- *Symptom:* `sync-status.js` (the launchd job running every 30 min) was failing with: `'filter' invalid for 'instantlyCampaignId[neq]:'. eg: price[gte]:10`
- *Root cause:* The filter `{ instantlyCampaignId: { neq: '' } }` was generating `instantlyCampaignId[neq]:` with an empty string after the colon. The Twenty API requires a non-empty value for `neq` filters.
- *Why empty-string neq doesn't work:* The Twenty REST filter syntax is `field[op]:value`. An empty `value` is syntactically invalid. There's no `IS NOT NULL` equivalent in the filter builder.
- *Fix:* Removed the API filter entirely. Now fetches all people, then filters client-side with `people.filter(p => !!p.instantlyCampaignId)`. The CRM is small enough (~1,000 people) that this is fast and avoids the filter syntax problem permanently.
- *File:* `scripts/sync-status.js` line ~118

**Bug 2: `push-to-instantly.js` ignoring `--test` CLI flag**
- *Symptom:* Running `push-to-instantly.js <csv> --test subject_v1` still generated campaign labels without the test suffix (e.g. `hot_A` instead of `hot_A_subject_v1`), causing all 707 leads to fail routing.
- *Root cause:* `batchTestName` was resolved only from the CSV rows (`rows.find(r => r.testName)?.testName`). When a batch CSV was prepared without `--test`, the CSV has an empty `testName` column. The CLI `--test` argument was never consulted as a fallback.
- *Why this matters:* When you run `prepare-batch.js` standalone (without `--test`), the output CSV has no testName. The push step then needs the `--test` flag to resolve campaign names. Without the fallback, it silently fails to match any campaign and aborts.
- *Fix:* Changed the resolution line to: `rows.find(r => r.testName)?.testName || opts.testName || getArg('--test') || ''`
- *File:* `scripts/push-to-instantly.js` line ~257

**Bug 3: Weekly pipeline not enforcing ramp limits**
- *Symptom:* `prepare-batch.js` was applying a 1,200/week limit (steady state) instead of the correct week-1 limit of 900/week. This meant the pipeline would push more leads than the inbox ramp supports during the critical warm-up period.
- *Root cause:* `run-pipeline.js` called `prepareBatch()` without passing `campaignStart`. Without a start date, `rampBatchLimit()` defaults to the steady-state maximum. The campaign start date was never threaded through from config to the prepare step.
- *Why the ramp matters:* Sending too many emails per inbox per day during warm-up triggers spam filters. ISPs rate-limit new sending domains, so exceeding the ramp during weeks 1-2 can permanently damage deliverability for all 6 inboxes.
- *Fix:* Added `CAMPAIGN_START_DATE=2026-03-10` to `.env`. `run-pipeline.js` now reads this via `process.env.CAMPAIGN_START_DATE` and passes it to `prepareBatch` as `campaignStart`. The ramp is now automatically enforced based on how many weeks have elapsed since campaign start.
- *Files:* `scripts/run-pipeline.js`, `.env`

**Bug 4: No enrichment freshness gate**
- *Symptom:* Leads could sit in `scored` state for days or weeks after enrichment before being pushed. When eventually pushed, the `{{hookText}}` personalizations referenced stale LinkedIn/Instagram activity.
- *Root cause:* `prepare-batch.js` had no concept of when a lead was enriched. It would happily queue leads imported a week ago alongside leads imported today.
- *Why freshness matters:* Hot and High tier emails open with a personalized hook referencing specific recent activity ("I saw you posted about X last week"). If the post was actually 10 days ago, the hook reads as stale and loses credibility. The 2-day window ensures the enrichment data is recent enough to feel genuine.
- *Fix:*
  1. Added `enrichedAt` field to the Twenty CRM schema (`setup-twenty-fields.js`)
  2. `bulk-import-twenty.js` now sets `enrichedAt` on every import (from `linkedin_enriched_at` in the enriched CSV, or falls back to import timestamp)
  3. `prepare-batch.js` filters out leads where `enrichedAt` is older than `ENRICHMENT_MAX_AGE_DAYS` (2). Filtered leads stay `scored` and are picked up on the next full pipeline run.
  4. Legacy leads (no `enrichedAt` value) pass through without filtering to avoid breaking existing data.
- *Files:* `scripts/lib/constants.js`, `scripts/lib/twenty-client.js`, `scripts/setup-twenty-fields.js`, `scripts/prepare-batch.js`

---

## Discloser Value Propositions

These are the core value props that all email copy is built on. Each email in the sequence leads with a different one.

1. **ChatGPT falls short** — Rate limits, only upload 2-3 documents at a time. By the 4th document, context is lost and answers become generic. Discloser keeps context across every document and handles bulk uploads of entire disclosure packets.

2. **Get answers between showings** — Chat with your documents and get real-time, inline citations back to the source page. Never lose context. Compare between documents. Great for reviewing between showings when you don't have time to read 200 pages.

3. **Set the stage, paint their picture** — Send the analysis to buyer clients before the showing. They get a plain-English summary with every finding ranked by severity, repair cost estimates, and exactly what to ask about during the inspection.

4. **Less time reading, more time selling** — Upload takes 2 minutes. The analysis replaces hours of manual document review.

5. **Cost estimates included** — Every finding includes estimated repair cost ranges. Foundation crack on page 47? You see a dollar range. Walk into negotiations knowing what things actually cost. Impress clients by showing up with numbers instead of guesses.

6. **Think like a real estate agent** — The product is built for how agents actually work: between showings, on mobile, under time pressure. Not a generic AI tool repurposed for real estate.

### Value props deployment tracker

| # | Value Prop | Email Language | Variant | Email # | Scheduled | Sent | Hot | High | Medium |
|---|-----------|---------------|---------|---------|-----------|------|-----|------|--------|
| 1 | **ChatGPT falls short** | "Have you tried uploading disclosures to ChatGPT? It works for the first couple docs, but by the 3rd or 4th it starts losing context and giving you generic answers." | A | 1 (opener) | 2026-03-11 | — | 50% | 50% | 50% |
| 2 | **Speed + cost estimates** | "247 pages. Full analysis back in under 3 minutes — every finding ranked by severity, with repair cost estimates attached. Foundation crack? You see a dollar range." | B | 1 (opener) | 2026-03-11 | — | 50% | 50% | 50% |
| 3 | **Chat with docs / between showings** | "You can chat with the documents. Ask anything about the property and get answers with inline citations, right back to the source page. Works well between showings." | A | 2 | 2026-03-14 | — | 50% | 50% | 50% |
| 4 | **Full packet upload** | "Takes the entire packet at once — seller disclosure, inspection, pest report, all of it. Keeps context across every document so findings get cross-referenced." | B | 2 | 2026-03-14 | — | 50% | 50% | 50% |
| 5 | **Cost estimates / negotiation** | "Repair cost estimates for every finding. Foundation crack on page 47? You see a range. Walk into a negotiation knowing what things actually cost." | A | 3 | 2026-03-19 | — | 50% | 50% | 50% |
| 6 | **Chat with docs / between showings** | (same as #3 — appears in both variants at different positions) | B | 3 | 2026-03-19 | — | 50% | 50% | 50% |
| 7 | **Breakup (ChatGPT callback)** | "Next time you get a 200-page disclosure packet, run it through Discloser before the inspection." | A | 4 | 2026-03-24 | — | 50% | 50% | 50% |
| 8 | **Breakup (speed callback)** | "Next time a 200-page disclosure packet hits your desk, upload it to Discloser. Full breakdown in under 3 minutes, repair costs included." | B | 4 | 2026-03-24 | — | 50% | 50% | 50% |
| 9 | **Set the stage for buyers** | "Send the analysis to your buyer clients before the showing. Plain-English summary, every finding ranked by severity, repair cost estimates, what to ask during inspection." | C | C1 | TBD* | — | 100% | — | — |
| 10 | **Soft close (nurture)** | "Next time you're staring at a thick disclosure packet, give Discloser a shot. Two minutes, full breakdown, first property free." | C | C2 | TBD* | — | 100% | — | — |
| 11 | **Timing check (followup)** | "We connected a few weeks back about disclosure reviews. Wanted to check if the timing is better now." | D | D1 | TBD* | — | 100% | — | — |

**Schedule basis:** Batch 1 (345 leads) pushed 2026-03-10, campaigns activated same day. First send window: Tue 2026-03-11 9-11am PT. Delays are calendar days (day 0, +3, +8, +13). All send dates fall Mon-Fri.

\* Nurture (C) and soft followup (D) trigger after first sequence completes + cooldown. Earliest eligible: ~2026-04-07 (14-day sequence + 17-day cooldown). Update **Sent** column as emails go out — `sync-status.js` tracks delivery timestamps.

**Not yet deployed:**
- "Less time reading, more time selling" (upload takes 2 min, replaces hours of review)
- "Think like a real estate agent" (built for how agents work: between showings, on mobile, under time pressure)

These are reserved for future A/B tests or sequence iterations.

---

### How value props map to the email sequence (A/B test)

**Variant A: ChatGPT comparison opener** — Tests whether agents respond to "ChatGPT falls short" framing.

| Email | Day | Value Prop | Angle |
|-------|-----|-----------|-------|
| A1 | 0 | ChatGPT falls short | Hook — "have you tried uploading disclosures to ChatGPT?" |
| A2 | +3 | Chat with docs / between showings | Value add — "you can chat with the documents" |
| A3 | +8 | Cost estimates / negotiation leverage | Proof — "walk in with numbers instead of guesses" |
| A4 | +13 | (breakup) | Direct close — action-oriented, references a specific use case |

**Variant B: Speed + cost estimates opener** — Tests whether agents respond to "3 minutes, costs included" framing.

| Email | Day | Value Prop | Angle |
|-------|-----|-----------|-------|
| B1 | 0 | Speed + cost estimates | Hook — "247 pages, full analysis in under 3 minutes, repair costs attached" |
| B2 | +3 | Full packet upload / context | Value add — "upload the entire packet at once, cross-references everything" |
| B3 | +8 | Chat with docs / between showings | Proof — "chat with documents, inline citations" |
| B4 | +13 | (breakup) | Direct close — "full breakdown in 3 minutes, costs included" |

**Re-engagement (same for all leads):**

| Email | Day | Value Prop | Angle |
|-------|-----|-----------|-------|
| C1 | 0 | Set the stage for buyers | Different angle — "send the analysis to your buyer clients" |
| C2 | +6 | (soft close) | Direct — "give Discloser a shot" |
| D | 0 | (timing check) | "Wanted to check if the timing is better now" |

---

## Copywriting Guidelines Applied

Email copy was written using skills from `Desktop/Skills/Marketing/`:

- **Brand voice**: No hype words, no exclamation points, no "revolutionize/transform/empower". No passive language ("I'll just leave this here", "no worries", "link is below if you ever need it"). Lead with facts.
- **Taboo phrases**: Avoided "game-changer", "seamlessly", "cutting-edge", "unlock", "supercharge", etc.
- **Structure**: Short paragraphs (1-3 sentences), plain English, specific product claims. Signature appended via `{{sender_name}}` merge variable.
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

6. **Instantly push** — `push-to-instantly.js` fetches campaign list from Instantly API, auto-routes each lead to the correct campaign by `{tier}_{variant}_{testName}` name convention. Assigns inboxes from shared pool (6 inboxes, round-robin by lowest send count), pushes to Instantly campaigns, writes back campaign IDs + timestamps to Twenty. Inbox reuse on nurture for sender consistency.

7. **Status sync** — `sync-status.js` polls Instantly every 30 min, maps events to CRM stages, sets `emailOpenedAt`/`repliedAt` timestamps on first occurrence, detects sequence completions after 14 days, detects re-engage eligibility after cooldowns, prints funnel snapshot + A/B test results table.

8. **Instantly campaigns** — `setup-instantly-campaigns.js` creates campaigns via API with full email sequences baked in. 8 campaigns created as drafts (6 first-touch A/B per tier + 1 nurture + 1 soft followup). Real copy written using brand voice skills — no placeholders.

9. **Email copy** — Tier-specific copy based on Discloser value props: ChatGPT context loss, chat with docs between showings, cost estimates for negotiation, direct breakup (action-oriented, no passive language). Hot tier gets `{{hookText}}` personalization, high tier gets `{{company}}`, medium is universal. All emails include a plain-text signature with `{{sender_name}}` (resolves to Lauri Parker or Jesslyn Rose per inbox), company tagline, and discloser.co.

10. **Timestamp fields** — Added 4 event timestamp fields (`firstContactedAt`, `emailOpenedAt`, `repliedAt`, `opportunityEnteredAt`) that capture first occurrence only and are never overwritten. Wired into push-to-instantly and sync-status.

### 2026-03-10 — CRM migration + enrichment bug fixes

1. **Twenty CRM migrated to cloud** — Moved from self-hosted Docker on Mac Mini (`http://100.126.152.109:3000` via Tailscale) to Twenty's hosted plan at `https://discloser.twenty.com` ($12/mo). No more dependency on Mac Mini being awake, Docker running, or Tailscale connected. Updated `.env`, all runbooks, and `crm/crm.md`.

2. **CRM data model re-created** — Ran `setup-twenty-fields.js` on the new cloud instance. All 35 custom fields created (People object metadata ID: `93add812-8163-4b64-ac04-e75a4a86b7b9`).

3. **Twenty API endpoints fixed** — Cloud Twenty serves the SPA at `/api/objects/` (returns HTML). All pipeline scripts updated to use `/rest/` endpoints which return JSON. Affected: `twenty-client.js` (`paginateAll`, `batchCreate`, `batchUpdate`, `upsertCompany`, `findPersonByEmail`).

4. **LinkedIn enrichment input field fixed** — `enrich-leads.js` was passing `{ urls }` to the `harvestapi/linkedin-profile-posts` actor, but the actor expects `{ profileUrls }`. Result: 0 profiles returned despite SUCCEEDED status. Fixed.

5. **LinkedIn result matching fixed** — The actor returns individual posts (not profiles). Each item is one post with `author.publicIdentifier` as the profile key. Rewrote `enrichLinkedIn()` to group posts by author and match via `publicIdentifier` instead of looking for `item.profileUrl`.

6. **Instagram username matching fixed** — `sones/instagram-posts-scraper-lowcost` returns posts with `scraped_username` and `user.username`, not `ownerUsername`. Updated the join logic to check `post.scraped_username || post.user?.username || post.ownerUsername`.

7. **Instagram caption parsing fixed** — Actor returns `caption` as an object (`{ pk, text }`) not a string. Added `getCaptionText()` helper that handles both string and object formats. Affects `isListingPost()`, `isSoldPost()`, `extractAddresses()`, `extractNeighborhoods()`.

8. **Instagram timestamp handling fixed** — Actor uses `taken_at` (Unix epoch in seconds) instead of `timestamp` (ISO string). Added `getPostDate()` helper that handles both formats.

9. **Apify client API updated** — `waitForFinish` option renamed to `waitSecs` in newer `apify-client` versions. Updated both LinkedIn and Instagram actor calls in `enrich-leads.js`.

10. **`select-from-pool.js` updated for Clay CSV format** — Added `ICP Post-Instagram` / `ICP Post Work Email` / `ICP Post-LinkedIn` as ICP score source columns (Clay's progressive scoring). Added IG handle URL stripping (Clay exports full Instagram URLs, not just usernames).

11. **10-lead test run validated** — Full pipeline tested: pool selection → LinkedIn + Instagram enrichment → ICP scoring → hook generation. Results: 8/10 LinkedIn enriched (80%), 10/10 Instagram enriched (100%), 10/10 hooks generated, ICP distribution: 1 Hot, 6 High, 3 Medium. Stale data penalties and recency bonuses confirmed working.

12. **Instantly v2 API payload fix** — `push-to-instantly.js` was sending `{ campaign_id, leads: [...] }` but the Instantly v2 `POST /leads` endpoint expects a flat object per lead: `{ email, campaign_id, first_name, ... }`. No bulk endpoint exists in v2. Rewrote `pushLeadsToCampaign()` to send one lead at a time.

13. **Shadow mode implemented** — `push-to-instantly.js` now checks `INSTANTLY_ENABLED` and `INSTANTLY_SHADOW_MODE` env vars. If `INSTANTLY_ENABLED=false` or `INSTANTLY_SHADOW_MODE=true`, the script runs in dry-run mode (no Instantly API calls, no CRM updates). Previously only the `--dry-run` CLI flag prevented real calls.

14. **CRM safety on push failure** — `push-to-instantly.js` now only updates CRM records to `contacted` if the Instantly push for that campaign had 0 errors. Previously, CRM was updated regardless of push success, causing dirty state (leads marked `contacted` when Instantly never received them).

15. **Company spacing in pool selection** — `select-from-pool.js` now enforces one lead per company per batch. Same-company leads are deferred to the back of the candidate list (not skipped), so they land in future batches instead of being emailed on the same day. Prevents multiple agents at the same brokerage receiving outreach simultaneously.

16. **launchd scheduling installed** — `sync-status.js` runs every 30 minutes via macOS launchd (`com.discloser.gtm.sync`). Full pipeline scheduled for Monday 6 AM (`com.discloser.gtm.pipeline`). Logs at `scripts/logs/`.

17. **10-lead push to Instantly successful** — All 10 test leads pushed: 1 hot_B, 3 high_B, 3 high_A, 3 medium_A. 6 inboxes balanced (2/2/2/2/1/1). CRM updated with campaign IDs, assigned inboxes, and timestamps. Pipeline confirmed end-to-end.

18. **Full pipeline automation** — `run-pipeline.js` extended with `--full` flag to chain all 6 steps: select → enrich → import → prepare → personalize → push. Upstream steps (select, enrich, import) run as child processes. Launchd plist updated to `--full --auto` on Monday 6 AM. Region filter removed — selects best leads across all regions.

19. **Lead pool moved to Desktop** — `select-from-pool.js` now reads from `LEAD_POOL_DIR` env var (default: `~/Desktop/Discloser_Leads/`). Three Clay CSVs: San Diego (~4,987), San Francisco (~4,781), South Bay (~3,121) = ~12,889 total leads. At 500/week, ~25 weeks of pipeline fuel.

20. **Region filter made optional** — `prepare-batch.js` and `run-pipeline.js` no longer require `--region`. When omitted, all regions are included. The automated Monday pipeline runs without a region filter.

---

## What Needs to Happen Next

### Automated (no action needed)

The Monday 6 AM pipeline handles everything: pool selection, enrichment, CRM import, batch preparation, personalization, and push to Instantly. Sync runs every 30 minutes.

### Manual monitoring

1. **Check pipeline ran** — `tail scripts/logs/launchd-pipeline.log` on Monday morning. Or check `scripts/logs/runs/` for the latest run directory.

2. **Activate new Instantly campaigns** — If the pipeline creates leads for tier/variant combos that don't have active campaigns yet, activate them in the Instantly UI. The pipeline creates campaigns as drafts.

3. **Monitor A/B results** — Run `npm run batch:sync -- --once --verbose` to see open/reply rates per campaign label.

### When pool runs dry (~25 weeks)

4. **Export new leads from Clay** — Drop new CSV files into `~/Desktop/Discloser_Leads/`. The pipeline will pick them up on the next Monday run. Existing leads (already in CRM) are automatically skipped.

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

*This document supersedes the implementation plan sections of `runbooks/cold-outreach/mass_email_pipeline.md` for current status. The mass_email_pipeline.md runbook remains the authoritative architecture reference.*
