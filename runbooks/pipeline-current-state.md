# Pipeline Current State — SQLite Operational Store

**Last updated:** 2026-03-12
**Status:** SQLite cutover in place for operational reads/writes, live send still pending post-cutover validation

## What Changed

The pipeline no longer treats Twenty as the operational database in the hot path.

Current operational flow:

1. `select-from-pool.js`
- reads dedup state from SQLite
- writes selected leads into SQLite and `pool_emails`

2. `enrich-leads.js`
- unchanged
- still runs real LinkedIn and Instagram enrichment through Apify

3. `bulk-import-twenty.js`
- now imports enriched rows into SQLite instead of Twenty
- upserts companies and leads locally

4. `prepare-batch.js`
- reads eligible `scored` leads from SQLite
- applies centralized suppression/cooldown policy
- writes queued state back to SQLite

5. `personalize-batch.js`
- unchanged in core behavior
- low-tier leads still use rule-based fallback

6. `push-to-instantly.js`
- still resolves campaign routing from Instantly
- writes campaign metadata and timestamps into SQLite

7. `sync-status.js`
- polls Instantly
- updates funnel stages and timestamps in SQLite

8. `sync-to-crm.js`
- creates/updates Twenty People from SQLite dirty records
- intended to keep Twenty as dashboard-only

## Current Automation Model

The pipeline now supports modular weekly strategy input through manifest files.

Examples:

- `scripts/strategy-template.json`
- `scripts/strategy-template.dry-run.json`
- `scripts/strategy-template.cold-e2e.json`
- `scripts/strategy-template.cold-e2e.dry-run.json`
- `scripts/strategy-template.cold-e2e.rehearsal.json`

These manifests control:

- mode
- region
- tier filter
- selection thresholds
- personalization budget
- dry-run vs push-disabled rehearsal vs live run

## Execution Modes

### 1. Full dry run

Use when you want orchestration and enrichment validation without operational writes or send.

### 2. Push-disabled rehearsal

Use when you want real operational state changes through import/prepare/personalize, but no Instantly send.

Behavior:

- real SQLite import
- real SQLite queueing
- dry-run push
- queued leads reset back to `scored` after rehearsal

### 3. Live run

Use when you want to actually push into Instantly.

## Most Recent Tested Path

Test run:

```bash
node scripts/run-pipeline.js --manifest scripts/strategy-template.cold-e2e.dry-run.json
```

Observed:

- 25 low-tier leads selected
- LinkedIn enrichment succeeded for 22/25
- Instagram enrichment succeeded for 22/25
- 20 low-tier leads were routed into valid Instantly campaigns in dry-run push mode
- no email was sent

Important note:

Because that run used full dry-run mode, the import step did not write the enriched batch into SQLite. That means it validated orchestration, enrichment, routing, and push planning, but not the full SQLite state transition path. The next safe validation path is the push-disabled rehearsal manifest.

## Remaining Risks

- `sync-to-crm.js` needs live validation against Twenty production behavior
- malformed Instagram handles in some source rows create avoidable enrichment noise
- launchd scheduling for `sync-to-crm.js` is still missing
- end-to-end live validation of the push-disabled rehearsal path is still pending
