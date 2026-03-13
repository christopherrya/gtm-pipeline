# SQLite Data Layer — Replace Twenty CRM as Operational Store

**Status:** Partially implemented and dry-run validated on 2026-03-12

## Current State

The SQLite operational store is now wired into the hot-path pipeline scripts:

- `select-from-pool.js` reads dedup state from SQLite
- `bulk-import-twenty.js` writes operational leads into SQLite
- `prepare-batch.js` reads eligibility from SQLite
- `sync-status.js` reads tracked leads from SQLite and writes status updates back to SQLite
- `push-to-instantly.js` writes push metadata to SQLite
- `sync-to-crm.js` is the bridge that creates/updates Twenty People from SQLite dirty records

The shared policy layer is centralized in `scripts/lib/lead-policy.js` so:

- stage suppression
- cooldown enforcement
- test dedup
- stage transition validation
- repush eligibility

all come from one place instead of being duplicated across scripts.

## What Was Added

- `scripts/lib/db.js` — SQLite schema, CRUD helpers, sync log, dirty-record tracking
- `scripts/lib/lead-mappers.js` — CSV/Twenty/SQLite field mappers
- `scripts/lib/lead-policy.js` — shared suppression, re-entry, and stage transition rules
- `scripts/seed-db-from-crm.js` — one-time seed from Twenty into SQLite
- `scripts/sync-to-crm.js` — async SQLite → Twenty dashboard sync
- `scripts/lib/run-manifest.js` — manifest-driven weekly strategy input
- `scripts/lib/prepush-report.js` — report generated before a real push or rehearsal

## Current Pipeline Behavior

There are now three useful execution modes:

1. Full dry run
- real selection and enrichment
- import/prepare/personalize/push side effects suppressed
- good for orchestration checks

2. Push-disabled rehearsal
- real selection, enrichment, import, prepare, personalize
- push step runs in dry-run mode
- queued leads created during the rehearsal are restored to `scored`
- good for end-to-end state validation without sending email

3. Live run
- full operational execution
- approval gate still applies unless explicitly skipped

## Dry-Run Findings (2026-03-12 cold low-tier test)

Command run:

```bash
node scripts/run-pipeline.js --manifest scripts/strategy-template.cold-e2e.dry-run.json
```

Observed outcome:

- `select` succeeded
- `enrich` succeeded
- `import` dry-ran only, so no SQLite writes happened
- `prepare` pulled from existing SQLite `scored` leads rather than the newly enriched CSV
- `personalize` correctly fell back to rule-based copy for low-tier leads
- `push` dry-ran cleanly with valid Instantly campaign routing

Runtime breakdown:

- selection: ~200ms
- enrichment: ~4 minutes
- local pipeline steps after enrichment: sub-second to low seconds

Key finding:

- SQLite removed CRM read overhead from the hot path
- enrichment remains the dominant wall-clock cost

## Known Gaps

- `sync-to-crm.js` still needs live production validation against Twenty create/update behavior
- malformed Instagram handles in some pool rows should be normalized earlier before enrichment
- scheduled automation for `sync-to-crm.js` is not yet installed
- the push-disabled rehearsal mode has been implemented but not yet exercised live

## Context

Twenty CRM (100 tokens/60s rate limit) is used as both the operational database and the human dashboard. **6 of 7 pipeline scripts start by loading the entire People table** — 250+ paginated API calls taking ~5 minutes each. At 15k leads, every pipeline run burns ~18 minutes just on CRM I/O. This must be fixed before we can scale.

The new architecture introduces SQLite as the operational data store. Twenty CRM becomes a read-only dashboard that receives async syncs.

---

## Architecture: Single Table, Stage-Based Layers

Raw leads go into the database first. The enrichment layer IS the transformation layer. We use **one `leads` table with `funnel_stage` as the layer indicator**, not separate raw/enriched/queued tables.

Why single table: Every script reads the same lead entity and mutates fields on it. `prepare-batch.js` needs enrichment fields (igUsername, linkedinHeadline) alongside outreach fields (abVariant, lastOutreachDate) in the same query. Separate tables would force JOINs or duplication. At 15k rows, one table with proper indexes is trivially fast.

**The `funnel_stage` column IS the layer:**
- `new` = raw layer (just imported from CSV, no enrichment)
- `scored` = enriched layer (LinkedIn/IG/ICP data populated)
- `queued` → `contacted` → `opened` → `replied` = operational layer
- Twenty CRM = presentation layer (receives async dirty-record syncs)

```
                            ┌─────────────┐
CSV (Clay)                  │  Twenty CRM │
    │                       │  (dashboard) │
    ▼                       │  ~12 fields  │
┌──────────┐   sync-to-crm  │  async sync  │
│  SQLite  │ ──────────────▶│  every 5 min │
│  leads   │                └─────────────┘
│  table   │
│ (all 40  │◀── sync-status.js reads Instantly
│  fields) │        (writes to SQLite only)
└──────────┘
    │
    ▼
  Instantly (v1 /lead/add, reads from CSV generated from SQLite)
```

---

## SQLite Schema

### Table 1: `leads` (primary — replaces Twenty People as operational store)

```sql
CREATE TABLE leads (
    id                    TEXT PRIMARY KEY,           -- UUID
    -- Core identity
    email                 TEXT NOT NULL UNIQUE,
    first_name            TEXT NOT NULL DEFAULT '',
    last_name             TEXT NOT NULL DEFAULT '',
    job_title             TEXT DEFAULT '',
    city                  TEXT DEFAULT '',
    company_name          TEXT DEFAULT '',
    company_id            TEXT DEFAULT '',
    -- ICP & engagement
    icp_score             INTEGER DEFAULT 0,
    icp_tier              TEXT DEFAULT '',
    trigger_score         INTEGER DEFAULT 0,
    hook_text             TEXT DEFAULT '',
    hook_variant          TEXT DEFAULT '',
    hook_source           TEXT DEFAULT '',
    region                TEXT DEFAULT '',
    -- Instagram enrichment
    ig_username           TEXT DEFAULT '',
    ig_followers          INTEGER DEFAULT 0,
    ig_days_since_post    INTEGER DEFAULT 999,
    ig_recent_addresses   TEXT DEFAULT '',
    ig_neighborhoods      TEXT DEFAULT '',
    ig_listing_posts_count INTEGER DEFAULT 0,
    ig_sold_posts_count   INTEGER DEFAULT 0,
    -- LinkedIn enrichment
    linkedin_url          TEXT DEFAULT '',
    linkedin_headline     TEXT DEFAULT '',
    linkedin_days_since_post INTEGER DEFAULT 999,
    linkedin_recent_topic TEXT DEFAULT '',
    -- Outreach tracking
    funnel_stage          TEXT NOT NULL DEFAULT 'new',
    last_outreach_date    TEXT DEFAULT '',
    outreach_status       TEXT DEFAULT '',
    ab_variant            TEXT DEFAULT '',
    ab_test_name          TEXT DEFAULT '',
    ab_test_history       TEXT DEFAULT '',
    assigned_inbox        TEXT DEFAULT '',
    campaign_label        TEXT DEFAULT '',
    instantly_campaign_id TEXT DEFAULT '',
    reply_to_address      TEXT DEFAULT '',
    first_contacted_at    TEXT DEFAULT '',
    email_opened_at       TEXT DEFAULT '',
    replied_at            TEXT DEFAULT '',
    re_engage_attempts    INTEGER DEFAULT 0,
    -- Enrichment metadata
    enriched_at           TEXT DEFAULT '',
    external_lead_id      TEXT DEFAULT '',
    lead_source           TEXT DEFAULT 'Clay',
    -- Personalization (SQLite-only)
    personalized_subject  TEXT DEFAULT '',
    personalized_hook     TEXT DEFAULT '',
    personalization_method TEXT DEFAULT '',
    -- Sync tracking (SQLite-only)
    twenty_id             TEXT DEFAULT '',
    twenty_dirty          INTEGER DEFAULT 1,
    twenty_synced_at      TEXT DEFAULT '',
    -- Pool tracking (SQLite-only)
    source_file           TEXT DEFAULT '',
    pool_selected_at      TEXT DEFAULT '',
    -- Timestamps
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table 2: `pool_emails` (fast dedup for pool CSV imports)

```sql
CREATE TABLE pool_emails (
    email       TEXT PRIMARY KEY,
    source_file TEXT NOT NULL,
    imported_at TEXT DEFAULT ''
);
```

### Table 3: `companies` (mirrors Twenty companies)

```sql
CREATE TABLE companies (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    domain     TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table 4: `sync_log` (audit trail)

```sql
CREATE TABLE sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id       TEXT NOT NULL,
    direction     TEXT NOT NULL,  -- 'to_crm' or 'from_instantly'
    fields_synced TEXT NOT NULL,
    synced_at     TEXT NOT NULL DEFAULT (datetime('now')),
    success       INTEGER NOT NULL DEFAULT 1,
    error_message TEXT DEFAULT ''
);
```

### Indexes (mapped to actual query patterns in pipeline scripts)

```sql
CREATE INDEX idx_leads_funnel_stage ON leads(funnel_stage);
CREATE INDEX idx_leads_icp_tier ON leads(icp_tier);
CREATE INDEX idx_leads_stage_score ON leads(funnel_stage, icp_score DESC);
CREATE INDEX idx_leads_stage_region ON leads(funnel_stage, region);
CREATE INDEX idx_leads_twenty_dirty ON leads(twenty_dirty) WHERE twenty_dirty = 1;
CREATE INDEX idx_leads_instantly_campaign ON leads(instantly_campaign_id) WHERE instantly_campaign_id != '';
CREATE UNIQUE INDEX idx_companies_name_lower ON companies(lower(name));
```

---

## What Syncs to Twenty CRM (~12 fields — minimal)

**Synced (what the sales team actually uses):**
1. `firstName`, `lastName`, `email` — identity
2. `companyName` — company
3. `icpTier` — lead quality at a glance
4. `funnelStage` — where they are in the pipeline
5. `outreachStatus` — last Instantly event (sent/opened/replied/bounced)
6. `region` — geography
7. `repliedAt` — when they replied (sales trigger)
8. `emailOpenedAt` — engagement signal
9. `linkedinLink` — for manual follow-up
10. `igUsername` — for manual follow-up

**Everything else lives only in SQLite** (~30 fields):
- All enrichment details (icp_score, trigger_score, hook_text, ig_followers, linkedin_headline, etc.)
- All campaign mechanics (ab_variant, ab_test_name, assigned_inbox, campaign_label, etc.)
- All personalization (personalized_subject, personalized_hook)
- All timestamps except repliedAt/emailOpenedAt
- All sync infrastructure (twenty_dirty, twenty_synced_at, etc.)

This dramatically reduces CRM write volume — only 12 fields per sync vs 35 today.

---

## Data Flow (New Architecture)

```
CSV (Clay exports in leads/pool/)
  │
  ▼
select-from-pool.js
  READS: pool_emails table (instant dedup — zero API calls)
  WRITES: leads table (funnel_stage='new'), pool_emails table
  OUTPUT: to_enrich CSV
  │
  ▼
enrichment/enrich-leads.js (unchanged — reads/writes CSV via Apify)
  │
  ▼
bulk-import.js (renamed from bulk-import-twenty.js)
  READS: enriched CSV + leads table (dedup) + companies table
  WRITES: leads table (funnel_stage='scored', enrichment fields populated)
  SETS: twenty_dirty=1
  │
  ▼
prepare-batch.js
  READS: leads table WHERE funnel_stage='scored' (instant — no API)
  WRITES: leads table (funnel_stage='queued', ab_variant, ab_test_history)
  SETS: twenty_dirty=1
  OUTPUT: batch CSV
  │
  ▼
personalize-batch.js (unchanged — reads/writes CSV)
  │
  ▼
push-to-instantly.js
  READS: personalized CSV
  WRITES: leads table (funnel_stage='contacted', campaign_id, inbox, timestamps)
  WRITES: Instantly API (v1 /lead/add)
  SETS: twenty_dirty=1
  │
  ▼
sync-status.js
  READS: leads table WHERE instantly_campaign_id != '' (instant — no CRM API)
  READS: Instantly API (polling for opens/replies/bounces)
  WRITES: leads table (funnel_stage transitions, timestamps)
  SETS: twenty_dirty=1

=== BACKGROUND (every 5 minutes via launchd) ===

sync-to-crm.js (NEW)
  READS: leads table WHERE twenty_dirty=1
  WRITES: Twenty CRM REST API (batchUpdate, only 12 fields)
  UPDATES: twenty_dirty=0, twenty_synced_at=now()
  WRITES: sync_log table (audit trail)
```

**The key change:** No pipeline script ever reads from Twenty CRM. They all read from SQLite (instant). Only `sync-to-crm.js` writes to Twenty, and it only pushes dirty records with 12 fields.

---

## State Machine (funnel_stage transitions)

```
new → scored                          (bulk-import after enrichment)
scored → queued                       (prepare-batch selects for outreach)
queued → contacted                    (push-to-instantly succeeds)
contacted → opened                    (sync-status: Instantly reports open)
contacted → bounced                   (sync-status: Instantly reports bounce)
contacted → sequence_complete         (sync-status: 14+ days, never opened)
opened → replied                      (sync-status: Instantly reports reply)
opened → opened_no_reply              (sync-status: sequence done, opened but no reply)
replied → replied_went_cold           (sync-status: 14+ days after reply)
opened_no_reply → nurture             (prepare-batch --mode nurture)
nurture → nurture_complete            (sync-status: nurture sequence done)
replied_went_cold → queued            (prepare-batch --mode soft_followup)
sequence_complete → re_engage_ready   (sync-status: cooldown expired)
nurture_complete → re_engage_ready    (sync-status: 90-day cooldown expired)
re_engage_ready → scored              (re-enrichment cycle)
* → bounced                           (override from any state)
* → unsubscribed                      (override from any state)
bounced → dropped                     (no alt email found)
```

Enforced in `db.js` via `transitionStage(leadId, newStage)` — validates transitions, sets `twenty_dirty=1` atomically.

---

## `db.js` Module Interface

```javascript
// scripts/lib/db.js — mirrors twenty-client.js interface

// Database lifecycle
getDb()                                    // Returns better-sqlite3 instance (lazy singleton)
initDb()                                   // Creates tables + indexes if not exist
closeDb()                                  // Graceful shutdown

// Lead CRUD
findLeadByEmail(email)                     // Replaces findPersonByEmail
findLeadsByStage(stage, opts)              // Replaces paginateAll with filter
insertLead(lead)                           // Single insert, sets twenty_dirty=1
insertLeads(leads)                         // Batch insert in transaction
updateLead(id, fields)                     // Single update, sets twenty_dirty=1
updateLeads(updates)                       // Batch update in transaction
transitionStage(id, newStage)              // Validates state machine, sets dirty

// Dedup
emailExists(email)                         // SELECT 1 from pool_emails or leads
loadAllEmails()                            // Returns Set<string> (instant)

// Company
findCompanyByName(name)
upsertCompany(name, domain)

// Sync support
getDirtyLeads(limit)                       // SELECT * WHERE twenty_dirty=1 LIMIT n
markSynced(ids)                            // SET twenty_dirty=0, twenty_synced_at=now()
logSync(leadId, direction, fields, success, error)

// Reporting
funnelSnapshot()                           // GROUP BY funnel_stage
abTestReport(testName)                     // Aggregated open/reply/bounce by campaign
```

---

## Implementation Phases

### Phase 1: Foundation
1. `npm install better-sqlite3`
2. Create `scripts/lib/db.js` — SQLite client with all functions above
3. Create `scripts/seed-db-from-crm.js` — one-time migration from Twenty (load all People + Companies, populate SQLite + pool_emails)

### Phase 2: Swap Readers (lowest risk, highest impact)
4. **`select-from-pool.js`** — replace `loadEmailIdMap()` with `db.emailExists()`
5. **`prepare-batch.js`** — replace `paginateAll('people')` with `db.findLeadsByStage()`; replace CRM `batchUpdate` with `db.updateLeads()`
6. **`sync-status.js`** — replace CRM reads with SQLite queries; replace CRM writes with `db.updateLeads()`

### Phase 3: Swap Writers
7. **`bulk-import-twenty.js`** → writes to SQLite (sets `twenty_dirty=1`)
8. **`push-to-instantly.js`** → CRM updates go to SQLite instead

### Phase 4: Background CRM Sync
9. Create `scripts/sync-to-crm.js` — queries `twenty_dirty=1`, pushes to Twenty via existing `batchUpdate`, marks synced
10. Add to launchd (every 5 minutes)

### Phase 5: Cleanup
11. Update `run-pipeline.js` to call `db.initDb()` at startup
12. Update `reset-queued-leads.js` and `repush-instantly-leads.js`

---

## Performance Impact

| Operation | Current (CRM) | After (SQLite) |
|-----------|---------------|----------------|
| select-from-pool dedup | ~5 min (250 pages) | <100ms |
| prepare-batch query + update | ~3 min | <200ms |
| sync-status full load + report | ~8 min (2 full loads) | <50ms + Instantly API |
| push-to-instantly CRM update | ~2 min | <100ms (async CRM) |
| **Total pipeline CRM overhead** | **~18 min** | **<500ms + async sync** |

---

## Files to Modify

| File | Change |
|---|---|
| `scripts/lib/db.js` | **NEW** — SQLite client, mirrors twenty-client.js interface |
| `scripts/lib/twenty-client.js` | Kept intact — used by sync-to-crm.js for CRM writes |
| `scripts/lib/constants.js` | No change — FUNNEL_STAGES and state machine rules stay here |
| `scripts/seed-db-from-crm.js` | **NEW** — one-time migration |
| `scripts/sync-to-crm.js` | **NEW** — background dirty-record pusher |
| `scripts/select-from-pool.js` | Swap `loadEmailIdMap()` → `db.emailExists()` |
| `scripts/prepare-batch.js` | Swap `paginateAll` → `db.findLeadsByStage()` |
| `scripts/sync-status.js` | Swap CRM reads/writes → SQLite |
| `scripts/bulk-import-twenty.js` | Swap CRM writes → SQLite |
| `scripts/push-to-instantly.js` | Swap CRM updates → SQLite |
| `scripts/run-pipeline.js` | Add `db.initDb()` at startup |

---

## Risk Mitigations

1. **Data loss if SQLite file corrupted:** WAL mode (`PRAGMA journal_mode=WAL`) for crash safety. Back up `.db` file before each pipeline run.
2. **CRM falls behind:** `twenty_dirty` flag guarantees eventual consistency. If `sync-to-crm.js` crashes, dirty records accumulate and push on next run.
3. **Rollback path:** `twenty-client.js` stays intact. Every script change is a data-source swap. Revert imports to go back to CRM reads.
4. **Concurrent access:** SQLite WAL supports concurrent readers with one writer. Pipeline runs weekly + sync loops every 30 min — no contention.

---

## Verification Checklist

- [ ] `seed-db-from-crm.js` loads all 1,062+ leads from Twenty into SQLite
- [ ] `select-from-pool.js` deduplicates in <1s (vs 5 min)
- [ ] `prepare-batch.js` queries scored leads in <1s
- [ ] Full pipeline run completes without touching Twenty directly
- [ ] `sync-to-crm.js` pushes dirty records and Twenty dashboard reflects changes within 5 min
- [ ] `sync-status.js` pulls Instantly events and writes to SQLite correctly
- [ ] Funnel report matches previous CRM-based report

---

*Created: 2026-03-12. Status: Planned — not yet implemented.*
