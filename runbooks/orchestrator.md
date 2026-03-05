# GTM Orchestrator Runbook

## Overview

The GTM orchestrator is a local node-based pipeline engine for lead operations.
It ingests Clay CSV exports, enriches with brokerage listing signals, scores and
segments leads, then syncs eligible contacts to a CRM provider.

Current status:

- Pipeline runtime and UI are implemented under `GTM/orchestrator/`.
- CRM provider abstraction is implemented in `N10`.
- `CRM_PROVIDER=twenty` is enabled in `.env`.
- Instantly sending is safety-disabled by default.

## Entry Points

- Start UI/API server:
  - `cd GTM && npm run orchestrator:start`
- UI URL:
  - `http://localhost:4312`
- Programmatic runner:
  - `runPipeline({ fromNode, dryRun, clayInputPath, maxContacts })` in `GTM/orchestrator/lib/pipeline.js`

## Pipeline Nodes

### Batch DAG

1. `N01_ClayUploadIngest`
  - Input: Clay CSV file
  - Output: `context.clayRows`
  - Validates required columns and supports `maxContacts` cap.

2. `N02_BrokerageScrape`
  - Input: local listing JSON data
  - Output: `context.rawListings`
  - Loads from `GTM/data/2listings/*.json` (latest files). If unavailable, uses synthetic fallback.

3. `N03_NormalizeRecords`
  - Normalizes contact and listing fields for matching.

4. `N04_DedupeListings`
  - Canonical dedupe by fingerprint.
  - Writes dedupe report and updates dedupe state index.

5. `N05_ContactJoin`
  - Match priority:
    1. email exact
    2. name + brokerage
    3. fuzzy name + geo
  - Output includes match confidence and listing rollups.

6. `N06_TriggerScoring`
  - Computes `icp_score`, `icp_tier`, `trigger_score`, `trigger_qualified`.

7. `N07_ABVariantAssignment`
  - Deterministic A/B variant assignment per lead and tier.

8. `N08_SuppressionFilter`
  - Filters by email validity, suppression, cooldown.

9. `N09_TriggerQueueExport`
  - Writes trigger queue CSV and checksum manifest.

10. `N10_CrmUpsert`
  - Always updates local CRM mirror state.
  - Conditionally syncs to remote CRM via provider abstraction:
    - `local` or `twenty`.

11. `N11_InstantlyPush`
  - Currently controlled by safety flags:
    - `INSTANTLY_ENABLED=false` (default) -> disabled
    - `INSTANTLY_SHADOW_MODE=true` -> shadow mode

12. `N12_RunReports`
  - Writes run-level QA and summary artifacts.

### Event Nodes

- `E01_InstantlyEventIngest`: process Instantly event payloads.
- `E02_ManualRequeue`: queue lead IDs for reprocessing.
- `E03_CrmWebhookIngest`: ingest CRM webhook payloads.

## Storage Layout

`GTM/data/orchestrator/`

- `ingestion/` raw uploaded inputs
- `staging/` normalized working datasets
- `curated/` deduped/merged artifacts
- `output/` exported reports and queue files
- `runs/<run_id>/` per-run node reports and run summary
- `state/` local mirrors and pipeline state

## API Endpoints

- `GET /api/state`
- `POST /api/run`
- `POST /api/upload-clay`
- `POST /api/events/instantly`
- `POST /api/events/manual-requeue`
- `POST /api/events/crm-webhook`

## Core Environment Variables

### CRM

- `CRM_PROVIDER=twenty|local`
- `CRM_DRY_RUN=true|false`
- `CRM_MAX_UPSERT_PER_RUN=500`

Twenty-specific:

- `TWENTY_BASE_URL=http://100.126.152.109:3000`
- `TWENTY_API_KEY=<your-api-key>`

See `crm/crm.md` for full Twenty deployment, custom field setup, and access details.

### Instantly Safety

- `INSTANTLY_ENABLED=false` (recommended default)
- `INSTANTLY_SHADOW_MODE=true`

## Validation Strategy

Use this sequence before scaling:

1. `maxContacts=50`, `CRM_DRY_RUN=true`
2. `maxContacts=50`, `CRM_DRY_RUN=false`
3. `maxContacts=500`, `CRM_DRY_RUN=false`

Only then consider larger batches.

## Known Limitations

1. `N02` currently loads listing JSON snapshots; it does not actively orchestrate per-brokerage crawl runs in-node.
2. `N10` is still single-threaded for remote sync, so large batches can be slow.
3. Run history UI supports run selection, but live in-flight progress is basic.

## Operational Commands

- Start orchestrator:
  - `cd GTM && npm run orchestrator:start`

## Immediate Next Work

1. Add progress checkpoints during long CRM sync runs.
3. Add run-level lock to prevent concurrent overlapping `N10` sync runs.
4. Remove synthetic listing fallback in non-test mode.
