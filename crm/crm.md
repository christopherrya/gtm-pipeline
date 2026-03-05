# CRM Infrastructure (Twenty on Mac mini)

## Objective

Run a private, self-hosted CRM for DISCLOSER on a Mac mini, reachable from a MacBook over Tailscale, and integrated with the GTM orchestrator as the system of record for contacts and funnel state.

## Current Decision

- CRM platform: Twenty CRM (open-source, modern REST API)
- Hosting: Mac mini (persistent, via Docker Compose)
- Remote access: Tailscale private network
- Public exposure: none
- Outbound send path: disabled until warmup complete

## Access

- Twenty UI: `http://100.126.152.109:3000`
- API base: same URL, endpoints under `/rest/`
- Auth: Bearer token (API key generated in Twenty Settings > Accounts > API keys)
- Works from anywhere — Tailscale is a mesh VPN, not LAN-only. As long as both machines are signed into Tailscale and the Mac mini is awake, the IP works from any network.

## Why Twenty over SuiteCRM

| Concern | SuiteCRM | Twenty |
|---------|----------|--------|
| API | REST v4.1, URL-encoded forms, MD5 auth | Clean JSON REST, Bearer token |
| Auth | Session login + MD5 password hash | API key in header |
| Lookup | Raw SQL via `get_entry_list` | Filter API (`?filter=...`) |
| Batch | Serial only | Up to 60/request (future) |
| UI | Legacy PHP | Modern React app |
| Maintenance | Heavy Docker image, frequent issues | Simple 4-container stack |

## Docker Deployment

Stack lives at `crm/docker-compose.yml`. Four containers:

| Container | Port | Purpose |
|-----------|------|---------|
| `twenty-server` | 3000 | API + web UI |
| `twenty-worker` | — | Background jobs |
| `postgres` | 5432 | Database |
| `redis` | 6379 | Cache/queue |

Deploy to Mac mini:

```bash
# From MacBook, copy compose file
scp ~/Desktop/gtm-pipeline/crm/docker-compose.yml nimeshsilva@100.126.152.109:~/twenty/

# SSH in and start
ssh nimeshsilva@100.126.152.109
cd ~/twenty

# Unlock keychain (required for SSH sessions to pull Docker images)
security -v unlock-keychain ~/Library/Keychains/login.keychain-db

docker compose up -d

# Check health
docker compose ps
curl http://localhost:3000/healthz
```

First-run setup:
1. Open `http://100.126.152.109:3000` in browser
2. Create workspace and admin account
3. Go to Settings > Accounts > API keys > Create new key
4. Copy the key to `.env` as `TWENTY_API_KEY`

### Custom fields

15 custom fields on the People object were created via the metadata API (2026-03-04). All API names confirmed matching `twenty.js` field mapping:

```bash
# Example: create a field via API
curl -X POST http://100.126.152.109:3000/rest/metadata/fields \
  -H "Authorization: Bearer $TWENTY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"icpScore","label":"ICP Score","type":"NUMBER","objectMetadataId":"<people-object-id>"}'
```

People object metadata ID: `1b8108be-5895-497e-832a-1c8101a06040`

### Keeping Mac mini awake

Prevent sleep so Twenty stays reachable:

```bash
sudo pmset -c sleep 0 disablesleep 1
```

## Orchestrator Integration Model

`N10` uses CRM provider abstraction:

- `CRM_PROVIDER=twenty`
- Connector path: `orchestrator/lib/crm/twenty.js`

Behavior:

1. Bearer token auth on every request (no session management)
2. Find person by email via filter API
3. Upsert into People object (create or update)
4. Respect `CRM_DRY_RUN` and `CRM_MAX_UPSERT_PER_RUN`

Rate limit: Twenty allows ~100 API calls/min. Serial upsert uses 2 calls/contact (~50 contacts/min). A 500-contact batch takes ~10 minutes.

## Required Environment Variables (`.env`)

- `CRM_PROVIDER=twenty`
- `TWENTY_BASE_URL=http://100.126.152.109:3000`
- `TWENTY_API_KEY=<your-api-key>`
- `CRM_DRY_RUN=true`
- `CRM_MAX_UPSERT_PER_RUN=500`

Recommended for early-stage safety:

- Keep `CRM_DRY_RUN=true` for first mapping checks
- Then set `CRM_DRY_RUN=false` for controlled write batches

## Security Notes

1. Rotate API key immediately if shared in chat or logs.
2. Keep Twenty reachable only via Tailscale — no router port forwarding.
3. Keep Mac firewall enabled and limit exposed services.
4. Use a strong `APP_SECRET` in docker-compose (change the default).

## Data Mapping

Contact upsert from pipeline to Twenty People object:

### Standard Fields

| Pipeline Field | Twenty Field |
|---------------|-------------|
| `First Name` | `name.firstName` |
| `Last Name` | `name.lastName` |
| `Email` / `Work Email` | `emails.primaryEmail` |
| `Company Name` | `company` |
| `job_title` | `jobTitle` |
| `LinkedIn Profile` | `linkedinLink.primaryLinkUrl` |

### Custom Fields

Created via metadata API on 2026-03-04 (all confirmed matching `twenty.js`):

| Pipeline Field | Twenty Custom Field | Type |
|---------------|-------------------|------|
| `icp_score` | `icpScore` | Number |
| `icp_tier` | `icpTier` | Text |
| `trigger_score` | `triggerScore` | Number |
| `hook_text` | `hookText` | Text |
| `hook_variant` | `hookVariant` | Text |
| `hook_source` | `hookSource` | Text |
| `ig_username` / `IG handle` | `igUsername` | Text |
| `linkedin_headline` | `linkedinHeadline` | Text |
| `linkedin_days_since_post` | `linkedinDaysSincePost` | Number |
| `linkedin_recent_topic` | `linkedinRecentTopic` | Text |
| `ig_followers` | `igFollowers` | Number |
| `ig_days_since_post` | `igDaysSincePost` | Number |
| `external_lead_id` | `externalLeadId` | Text |
| `funnel_stage` | `funnelStage` | Text |
| `source_primary` | `leadSource` | Text |

All field API names were specified at creation time and match `twenty.js` exactly — no post-creation mapping changes needed.

## Current Status (2026-03-04)

- Twenty deployed and running on Mac mini via Docker Compose
- Admin workspace created, API key generated and stored in `.env`
- All 15 custom fields created via metadata API
- API connectivity verified (200 on `/rest/people`)
- Dry-run pipeline test: **not yet run**
- Live write test: **not yet run**

## Bring-Up and Test Sequence

1. Dry run, 50 contacts:
  - `CRM_DRY_RUN=true`, `maxContacts=50`
  - Verify `twenty-dry-run` mode in run report
2. Real write, 5 contacts:
  - `CRM_DRY_RUN=false`, `CRM_MAX_UPSERT_PER_RUN=5`
  - Verify 5 contacts appear in Twenty UI
3. Re-run same 5:
  - Verify they show as `updated` (not duplicated)
4. Scale to 50, then 500:
  - `CRM_MAX_UPSERT_PER_RUN=50`, then `500`

Do not jump directly to full 4k+ ingestion until mapping and duplicate behavior are validated.

## Operational Guardrails

1. Keep Instantly disabled while email infrastructure warms up:
  - `INSTANTLY_ENABLED=false`
  - `INSTANTLY_SHADOW_MODE=true`
2. Use capped CRM writes:
  - `CRM_MAX_UPSERT_PER_RUN=500`
3. Run from `N01` unless intentionally testing isolated nodes.

## Known Risks

1. Serial upserts at ~50/min — acceptable for current batch sizes, batch API optimization possible later.
2. Mac mini must stay awake and connected to Tailscale for remote access — use `pmset` to disable sleep.
3. Without strict progress checkpoints, long runs can appear "stuck".

## Recommended Next Improvements

1. Use Twenty's batch API (up to 60 records/request) for faster sync.
2. Add progress counters to `run-summary` during `N10`.
3. Add per-run lock to prevent concurrent CRM sync runs.
4. Add explicit "fail if no upstream context" guard when starting directly from sink nodes.
