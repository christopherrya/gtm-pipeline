# CRM Infrastructure (SuiteCRM on Mac mini)

## Objective

Run a private, self-hosted CRM for DISCLOSER on a Mac mini, reachable from a MacBook over Tailscale, and integrated with the GTM orchestrator as the system of record for contacts and funnel state.

## Current Decision

- CRM platform: SuiteCRM
- Hosting: Mac mini (persistent)
- Remote access: Tailscale private network
- Public exposure: none
- Outbound send path: disabled until warmup complete

## Access

Current known endpoint:

- `http://100.126.152.109:8080`

## Orchestrator Integration Model

`N10` uses CRM provider abstraction:

- `CRM_PROVIDER=suitecrm`
- Connector path:
  - `GTM/orchestrator/lib/crm/suitecrm.js`

Behavior:

1. Login to SuiteCRM REST (`/service/v4_1/rest.php`)
2. Find contact by email
3. Upsert into `Contacts` module (create/update)
4. Respect `CRM_DRY_RUN` and `CRM_MAX_UPSERT_PER_RUN`

## Required Environment Variables (`GTM/.env`)

- `CRM_PROVIDER=suitecrm`
- `SUITECRM_BASE_URL=http://100.126.152.109:8080`
- `SUITECRM_USERNAME=<api user>`
- `SUITECRM_PASSWORD=<api password>`
- `CRM_DRY_RUN=true`
- `CRM_MAX_UPSERT_PER_RUN=500`

Recommended for early-stage safety:

- Keep `CRM_DRY_RUN=true` for first mapping checks
- Then set `CRM_DRY_RUN=false` for controlled write batches

## Security Notes

1. Rotate credentials immediately if shared in chat or logs.
2. Prefer a dedicated API user (non-admin) for orchestrator sync.
3. Keep CRM reachable only via Tailscale.
4. No router port forwarding.
5. Keep Mac firewall enabled and limit exposed services.

## Data Mapping (Current)

Contact upsert source fields:

- `Email` or `Work Email` -> `email1`
- `First Name` -> `first_name`
- `Last Name` -> `last_name`
- `Company Name` -> `account_name`
- `external_lead_id` -> written into description payload marker
- `funnel_stage` -> `status`

Note: additional rich fields should be added as SuiteCRM custom fields for full parity with scoring metadata.

## Bring-Up and Test Sequence

1. Dry run, 50 contacts:
  - `CRM_DRY_RUN=true`, `maxContacts=50`
2. Real write, 50 contacts:
  - `CRM_DRY_RUN=false`, `maxContacts=50`
3. Real write, 500 contacts:
  - `CRM_DRY_RUN=false`, `maxContacts=500`

Do not jump directly to full 4k+ ingestion until mapping and duplicate behavior are validated.

## Operational Guardrails

1. Keep Instantly disabled while email infrastructure warms up:
  - `INSTANTLY_ENABLED=false`
  - `INSTANTLY_SHADOW_MODE=true`
2. Use capped CRM writes:
  - `CRM_MAX_UPSERT_PER_RUN=500`
3. Run from `N01` unless intentionally testing isolated nodes.

## Known Risks

1. SuiteCRM REST v4.1 is older API surface; monitor for session/auth quirks.
2. Large runs may be slow due to serial upserts.
3. Without strict progress checkpoints, long runs can appear “stuck”.

## Recommended Next Improvements

1. Add progress counters to `run-summary` during `N10`.
2. Add per-run lock to prevent concurrent CRM sync runs.
3. Extend SuiteCRM mapping to custom fields:
  - `icp_score`, `icp_tier`, `trigger_score`, `trigger_qualified`, `last_listing_date`, etc.
4. Add explicit “fail if no upstream context” guard when starting directly from sink nodes.
