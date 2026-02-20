# GTM Orchestrator (V1)

Local node-graph orchestration app for GTM lead ops:

- Batch DAG nodes `N01..N12`
- Event nodes `E01..E03`
- Run history + node reports
- Upload Clay CSV
- Trigger queue export
- Local mirror sync for CRM + Instantly

## Start

```bash
cd GTM
npm run orchestrator:start
```

Open:

- [http://localhost:4312](http://localhost:4312)

Set a custom port:

```bash
GTM_ORCHESTRATOR_PORT=4400 npm run orchestrator:start
```

## Storage

Artifacts and state are written under:

- `GTM/data/orchestrator/ingestion`
- `GTM/data/orchestrator/staging`
- `GTM/data/orchestrator/curated`
- `GTM/data/orchestrator/output`
- `GTM/data/orchestrator/runs`
- `GTM/data/orchestrator/state`

## Implemented Nodes

- `N01_ClayUploadIngest`
- `N02_BrokerageScrape`
- `N03_NormalizeRecords`
- `N04_DedupeListings`
- `N05_ContactJoin`
- `N06_TriggerScoring`
- `N07_ABVariantAssignment`
- `N08_SuppressionFilter`
- `N09_TriggerQueueExport`
- `N10_CrmUpsert`
- `N11_InstantlyPush`
- `N12_RunReports`

## Event Endpoints

- `POST /api/events/instantly`
- `POST /api/events/manual-requeue`
- `POST /api/events/crm-webhook`

## Notes

- V1 uses local state mirrors for CRM and Instantly (`data/orchestrator/state/*.json`).
- API retries, idempotency keys, and run-scoped artifacts are implemented.
- You can run full DAG, dry-run, or start from any node from the UI.

## Instantly Safety Flags

To prevent accidental sends during email warmup:

```bash
INSTANTLY_ENABLED=false
INSTANTLY_SHADOW_MODE=true
```

Behavior in `N11_InstantlyPush`:
- `INSTANTLY_ENABLED=false` -> push is skipped (`mode: "disabled"`)
- `INSTANTLY_ENABLED=true` and `INSTANTLY_SHADOW_MODE=true` -> shadow/local mirror only (`mode: "shadow"`)
- External Instantly network sends are not implemented in V1 connector.

## CRM Provider Switch

`N10_CrmUpsert` supports provider-based sync:

- `CRM_PROVIDER=local` -> local mirror only
- `CRM_PROVIDER=suitecrm` -> SuiteCRM API sync

SuiteCRM env vars:

```bash
CRM_PROVIDER=suitecrm
SUITECRM_BASE_URL=http://<your-suitecrm-url>
SUITECRM_USERNAME=<your-crm-user>
SUITECRM_PASSWORD=<your-crm-password>
CRM_DRY_RUN=true
CRM_MAX_UPSERT_PER_RUN=500
```

Notes:
- SuiteCRM sync uses legacy REST `service/v4_1/rest.php`.
- Contacts are upserted into `Contacts` module by email.
- Set `CRM_DRY_RUN=false` for real writes after validation.

