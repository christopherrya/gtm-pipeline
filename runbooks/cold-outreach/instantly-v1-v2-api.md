# Instantly API: v1 vs v2 Lead Push (Critical Blocker — RESOLVED)

## The Problem

From March 10–12, 2026, **zero emails were sent** despite 1,062 leads being loaded and 10 campaigns created. Three cascading bugs caused a complete pipeline stall:

1. **v2 `POST /api/v2/leads` silently drops `campaign_id`** — leads were created in the workspace but stored with `campaign_id: null`. All leads were orphaned.
2. **Campaign schedule `days` field requires integer keys** — our code used string names (`"monday": true`) which Instantly silently stored as `{}` (empty). No send days = no sends.
3. **Campaigns auto-complete when they have no associated leads** — after fixing the schedule, campaigns saw 0 leads and immediately moved to `status=3` (completed).

**Root cause:** Instantly's v2 REST API has undocumented bugs. Their own UI uses a completely different internal v1 API.

---

## The Fix

### Lead Push: Use v1 `/lead/add` (NOT v2 `/leads`)

| | v2 (BROKEN) | v1 (WORKS) |
|---|---|---|
| Endpoint | `POST /api/v2/leads` | `POST /api/v1/lead/add` |
| Auth | `Authorization: Bearer {API_KEY}` | `x-org-auth: {JWT}` |
| Leads | Single lead per request | **Bulk array** (up to ~100 per call) |
| `campaign_id` | In lead body — **silently ignored** | Top-level field — **works** |
| Speed | ~75s for 500 leads (serial) | ~2s for 500 leads (bulk) |

**Working request:**

```
POST https://api.instantly.ai/api/v1/lead/add
Header: x-org-auth: {JWT}
Header: Content-Type: application/json

{
  "leads": [
    {"email": "...", "first_name": "...", "last_name": "...", "company_name": "...", "custom_variables": {...}}
  ],
  "campaign_id": "...",
  "skip_if_in_campaign": true,
  "skip_if_in_workspace": false,
  "verifyLeadsOnImport": false
}
```

**Response:**

```json
{
  "status": "success",
  "total_sent": 100,
  "leads_uploaded": 98,
  "in_blocklist": 1,
  "already_in_campaign": 1,
  "skipped_count": 0,
  "invalid_email_count": 0,
  "duplicate_email_count": 0,
  "remaining_in_plan": 23937
}
```

### Auth: Two Different Token Types

| API | Auth Header | Token Source | Env Var |
|-----|-------------|-------------|---------|
| v2 (campaigns, accounts) | `Authorization: Bearer {API_KEY}` | Instantly Settings > API Keys (base64 uuid:password) | `INSTANTLY_API_KEY` |
| v1 (lead/add, analytics) | `x-org-auth: {JWT}` | Browser DevTools > Network tab > any Instantly API call | `INSTANTLY_ORG_AUTH` |

The `x-org-auth` JWT payload is `{"w_id": "<workspace_uuid>"}`. No expiration field, but may be invalidated on logout. If auth fails, grab a fresh JWT from the Instantly UI in your browser.

### Schedule Days: Integer Keys Only

```javascript
// BROKEN — silently stored as {}
days: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true }

// WORKS
days: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false }
```

---

## Files Changed

| File | Change |
|---|---|
| `scripts/push-to-instantly.js` | Switched from v2 `POST /leads` (1-at-a-time, broken) to v1 `/lead/add` (bulk, working) |
| `scripts/repush-instantly-leads.js` | New script for re-pushing CRM leads to Instantly via v1 |
| `scripts/setup-instantly-campaigns.js` | Fixed `buildSchedule()` to use integer day keys |
| `.env` | Added `INSTANTLY_ORG_AUTH` JWT for v1 auth |

---

## v2 Endpoints That DO Work

These are fine to keep using with `Authorization: Bearer {API_KEY}`:

- `GET /api/v2/campaigns?limit=100` — list campaigns
- `GET /api/v2/campaigns/{id}` — campaign details
- `PATCH /api/v2/campaigns/{id}` — update campaign settings/status
- `GET /api/v2/accounts?limit=20` — list email accounts

## v1 Endpoints (require `x-org-auth`)

- `POST /api/v1/lead/add` — bulk add leads to campaign **(the only working lead push)**
- `POST /api/v1/lead/delete` — delete leads: `{"delete_list": ["email1", "email2"]}`
- `GET /api/v1/analytics/campaign/summary?campaign_id=...` — campaign stats

---

## Lessons Learned

1. **Always verify API behavior with the UI's own network calls.** The v2 docs say `campaign_id` works — it doesn't. The UI uses v1 internally.
2. **Watch for silent failures.** v2 returns `200 OK` when creating orphaned leads. The schedule days endpoint accepts string names and returns success. Neither error is surfaced.
3. **Test with a small batch first.** Push 10 leads, check the campaign analytics, verify association before running the full batch.

---

*Discovered: 2026-03-12. Fixed: 2026-03-12. Impact: 2 days of zero email sends, 1,062 leads orphaned then recovered.*
