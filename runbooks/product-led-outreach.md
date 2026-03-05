# Product-Led Outreach: Process, Strategy & Edge Cases

## Overview

Use Discloser's own product as the outreach mechanism. Reach out to listing agents as an interested buyer, request disclosure documents, process them through Discloser's AI pipeline, then send the agent a findings summary. The agent onboards to view the full analysis — converting them into a user who's already experienced the product's value.

**Scale**: 5-10 listings/week (validation phase)
**Outbound**: Instantly via personal email
**Inbound**: Custom reply-to per listing → Resend inbound webhook → auto-processing

---

## Full Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OUTBOUND PHASE                               │
│                                                                     │
│  Brokerage Scrape → Orchestrator N09b → Instantly Campaign          │
│  (Compass, CB,      (creates campaign     (sends buyer inquiry      │
│   Sotheby's,         record + unique       from personal email,     │
│   Intero)            reply-to address)     reply-to = inbound addr) │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    Agent replies with PDFs
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        INBOUND PHASE                                │
│                                                                     │
│  Resend Inbound Webhook → Parse Attachments → Upload to Storage     │
│  (disclosure-{id}          (validate PDFs,     (gtm-inbound-pdfs    │
│   @inbound.discloser.co)    decode base64)      bucket)             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                     Auto-trigger processing
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      PROCESSING PHASE                               │
│                                                                     │
│  Create Property → processing_queue → GCP Cloud Function            │
│  (under GTM         (existing           (Document AI OCR +          │
│   system user)       trigger)            AI summary generation)     │
│                                                                     │
│  → summaries table → embedding_generation_queue → document_chunks   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    All PDFs processed
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                       REVIEW PHASE                                  │
│                                                                     │
│  Completion detected → Draft findings email generated               │
│  → gtm_review_queue entry created                                   │
│  → Human reviews in GTM Hub dashboard                               │
│  → Approve / Edit / Reject                                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                         Approved
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      FINDINGS PHASE                                 │
│                                                                     │
│  Send findings email via Resend                                     │
│  (top 2-3 findings as teasers + CTA link)                           │
│  → Generate invite token (7-day expiry)                             │
│  → gtm_agent_invites record created                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    Agent clicks CTA link
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     ONBOARDING PHASE                                │
│                                                                     │
│  /invite/:token → Property preview (findings teaser, blurred)       │
│  → Minimal signup (email pre-filled, password, name)                │
│  → Claim invite → Transfer property to agent's account              │
│  → Redirect to full summary page                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase-by-Phase Strategy

### Phase 1: Outbound — Buyer Inquiry

**What happens**: The orchestrator scrapes recent listings, creates a campaign record per listing in Supabase, and pushes the lead to Instantly. Instantly sends the buyer inquiry email from your personal email, with a unique reply-to address per listing.

**Reply-to format**: `disclosure-{campaign_uuid}@inbound.discloser.co`

This lets us automatically correlate any reply to the exact listing and campaign record.

**Email tone**: Casual, personal, like a real buyer. References the specific property address. Asks for the disclosure package to do individual due diligence.

**What we track**:
| Field | Value |
|-------|-------|
| `status` | `pending` → `email_sent` |
| `outreach_email_id` | Instantly message ID |
| `reply_to_address` | The unique inbound address |

---

### Phase 2: Inbound — Receiving Disclosures

**What happens**: Agent replies to the email. Their reply goes to the unique reply-to address. Resend receives it and forwards it as a webhook POST to our Supabase edge function.

**Auto-processing flow**:
1. Parse webhook payload (from, to, subject, body, attachments)
2. Extract campaign ID from the to-address
3. Validate each attachment is a PDF
4. Upload PDFs to `gtm-inbound-pdfs` storage bucket
5. Create a `properties` record using the listing address
6. Create `property_disclosure_pdfs` records for each PDF
7. Copy files to `pdf-uploads-v2` (the bucket the processing pipeline reads from)
8. Insert into `processing_queue` — this triggers the existing OCR + AI pipeline

**GTM system user**: All GTM-originated properties are created under a dedicated Supabase Auth account. This user's properties are transferred to the agent during onboarding.

---

### Phase 3: Processing

**What happens**: The existing pipeline handles everything.

```
processing_queue INSERT
  → DB trigger fires notify_processing_queue()
  → process-pdf-orchestrator edge function
  → GCP Cloud Function (Document AI OCR + AI summary)
  → summaries table
  → embedding_generation_queue
  → generate-embeddings edge function (Voyage AI)
  → document_chunks table
```

No changes to any existing functions.

---

### Phase 4: Review

**What happens**: A completion handler detects when all PDFs for a campaign have been processed. It generates a draft findings email (pulling top critical/high severity findings from the summaries table) and queues it for human review.

**Review dashboard** (in GTM Pipeline hub at port 4312):
- Shows pending review items with agent name, property address, finding teasers, draft email
- Reviewer can edit the email copy, approve & send, or reject
- Also shows campaign funnel metrics

**Why human review**: Even though processing is fully automated, the email back to the agent is the conversion moment. A human eye on the findings and email copy ensures quality, catches AI errors, and lets you refine messaging over time.

---

### Phase 5: Findings Email

**What happens**: After approval, the system sends a branded email to the agent via Resend with:
- The property address
- Top 2-3 critical/high findings (severity + title only, no full descriptions)
- Total count of findings across all documents
- CTA button: "View Full Property Analysis" → `https://www.discloser.co/invite/{token}`

**Invite token**: A cryptographically random UUID with 7-day expiry.

---

### Phase 6: Agent Onboarding

**What happens**: Agent clicks the CTA → lands on `/invite/:token` (public page, no auth required).

1. **Token validated**: Shows property address + findings preview (titles only, full descriptions blurred)
2. **Value before signup**: Agent sees what Discloser found before creating an account
3. **Minimal signup**: Email (pre-filled), password, first name, last name
4. **Claim invite**: Property transferred from GTM system user to agent's new account
5. **Redirect**: Agent sees the full summary with all findings, repair costs, expert perspective

---

## Edge Cases & Handling

### Outbound Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Agent email missing from listing** | `agent_email` is null/empty in scraped data | Skip this listing. Do not guess emails. Log as `skipped_no_email` in orchestrator report. |
| **Email bounces** | Instantly bounce webhook / tracking | Update campaign status → `bounced`. Do not retry same address. Flag listing for manual review (email may be stale). |
| **Agent has already been contacted** | Check `gtm_outreach_campaigns` for existing record with same `agent_email` + `listing_address` | Skip. Prevent duplicate outreach. Dedup check runs in N09b before inserting. |
| **Instantly rate limits / quota** | Instantly API error response | Respect Instantly's sending limits. Queue overflow contacts for next batch. Log warning in orchestrator report. |
| **Agent email is a brokerage generic** (e.g. info@compass.com) | Pattern match against known generic prefixes (info@, admin@, office@, support@) | Skip. These won't reach the listing agent. |

### Inbound Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Reply has no attachments** | `attachments` array is empty | Insert `gtm_inbound_emails` record. Update campaign status → `replied`. Do NOT trigger processing. Queue for manual review — agent may have sent a text reply asking for clarification. |
| **Reply has non-PDF attachments** (images, Word docs, zip) | Check `content_type` — only accept `application/pdf` | Upload non-PDFs to storage for record-keeping but mark as `is_pdf = false`. If no PDFs in the email, update status → `replied` (not `disclosures_received`). |
| **PDF is corrupt or empty** | Magic bytes check (first 4 bytes should be `%PDF`), file size < 1KB | Mark attachment as `status = rejected` with reason. If all PDFs rejected, keep campaign in `replied` status. |
| **PDF is password-protected** | Document AI will fail during OCR | Processing pipeline marks it as `failed` in processing_queue. The completion handler should not block on failed PDFs — it should flag them in the review queue as "X of Y documents processed, Z failed (password-protected)". |
| **Agent sends disclosures in multiple emails** | Same campaign ID receives multiple inbound emails | Append new PDFs to the existing property. Re-trigger processing for new PDFs only. Update campaign status based on latest state. |
| **Reply comes from a different email** (agent forwarded, assistant replied) | `from_email` doesn't match `agent_email` on campaign | Process anyway — the campaign ID in the to-address is the source of truth, not the sender. Log the mismatch for analytics. |
| **Reply comes after campaign expired / already processed** | Campaign status is not `email_sent` | If `disclosures_received` or later: append PDFs to existing property. If `agent_onboarded`: upload to agent's account directly. If campaign doesn't exist: log as orphan, do not process. |
| **Resend webhook fires multiple times** (retry on timeout) | Same `message_id` in webhook payload | Idempotency check: store Resend `message_id` in `gtm_inbound_emails`. Skip if already processed. |
| **Attachment too large** (>25MB) | Check `size_bytes` before upload | Resend has a 40MB total email limit. For individual PDFs >25MB, use the existing signed-upload flow (large file handling already exists). If >50MB, reject with reason. |
| **Agent sends a link instead of attachments** (e.g. Dropbox, Google Drive) | URL detection in email body | Update status → `replied`. Queue for manual review. Body text is stored in `gtm_inbound_emails.body_text` for the reviewer to extract the link manually. |

### Processing Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **OCR fails** (Document AI error) | `processing_queue.status = failed` | Existing retry logic handles this: 3 retries with exponential backoff (2min, 5min, 10min). After 3 failures, marked as permanently failed. |
| **AI summary generation fails** | GCP Cloud Function error | Same retry logic as OCR. If permanent failure, the completion handler flags it in review queue. |
| **All PDFs fail processing** | All `processing_queue` items for property are `failed` | Completion handler creates a review queue item with `review_type = 'processing_failed'`. Reviewer decides: retry manually, request new files from agent, or abandon. |
| **Some PDFs succeed, some fail** | Mixed statuses in processing_queue | Completion handler creates review queue item noting partial success: "3 of 5 documents processed. 2 failed (reason)." Reviewer can approve with partial findings or wait for manual fix. |
| **Processing takes too long** (>30 min) | Existing monitoring edge function detects stuck documents | Monitoring function auto-resets stuck docs. For GTM campaigns, also flag in review queue if stuck >1 hour. |
| **Subscription enforcement blocks processing** | Orchestrator checks tier limits | GTM system user should be set to `admin` tier (unlimited processing) or `business` tier with high limits. This prevents the freemium limits from blocking GTM pipeline. |

### Review Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Review item sits pending >48 hours** | `created_at` comparison | Optional: send a Slack notification or email reminder to the reviewer. For validation phase, this is a manual check. |
| **Reviewer rejects the findings** | `status = rejected` | Campaign moves to a terminal state. Property and summaries remain in DB for reference but no findings email is sent. |
| **Draft email has inaccurate findings** | Reviewer catches during review | Reviewer edits the email copy directly in the dashboard. The edited version is what gets sent — AI draft is a starting point, not final. |
| **Property has no critical/high findings** | All findings are `moderate` or `info` severity | Still generate the findings email but adjust tone: "We reviewed the disclosures for 123 Main St and found a few items worth noting." Even moderate findings demonstrate value. |
| **Property has zero findings** | Summaries contain no findings (clean disclosures) | Create review item noting clean disclosures. Option to send a "good news" email: "We reviewed the disclosures and found no significant issues — your listing looks great." This still demonstrates the product. |

### Findings Email Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Resend send fails** | API error response | Retry up to 3 times with backoff. If persistent failure, mark review item as `send_failed` and alert reviewer. |
| **Email goes to spam** | No direct detection (can't track inbox placement) | Mitigation: Use Resend's sending reputation, warm up `inbound.discloser.co` domain, keep email content clean (no spammy language), include unsubscribe link. |
| **Agent's email no longer valid** | Resend bounce notification | Mark invite as `bounced`. Log for campaign analytics. No retry — contact is stale. |

### Onboarding Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Invite token expired** (>7 days) | `expires_at < now()` | Show friendly message: "This link has expired. Contact us at support@discloser.co to get a new one." Log expired click for analytics. |
| **Invite already claimed** | `status = onboarded` | If the agent is signed in, redirect to the summary page. If not signed in, show login prompt: "You've already created an account. Sign in to view your property analysis." |
| **Agent creates account with different email** | Email on signup doesn't match `agent_email` on invite | Allow it. The invite token is the source of truth, not the email match. Some agents use personal email vs work email. |
| **Agent abandons signup mid-flow** | Token status stays `clicked`, no `user_id` set | Token remains valid until expiry. Agent can return and complete signup later. Track `clicked` vs `onboarded` conversion in funnel metrics. |
| **Property transfer fails** (RLS, permissions) | Database error during `claim-agent-invite` | Roll back: keep property under GTM system user, mark invite as `claim_failed`. Alert admin. Agent sees an error page with support contact. |
| **Agent already has a Discloser account** | Email match during signup (Supabase returns "user already exists") | Show login form instead. After login, claim the invite and transfer the property to their existing account. |
| **Multiple invites for same agent** (contacted about different listings) | Same `agent_email` across multiple campaigns | Each invite is independent — one token per property. Agent may end up with multiple properties in their account. This is a feature, not a bug. |
| **Agent clicks link but doesn't want to sign up** | Token status stays `pending` (never moves to `clicked`) | No action needed. Track non-click rate in funnel metrics. Consider a follow-up email after 3 days: "Your property analysis is ready — don't miss it." |

### System-Level Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| **Resend inbound webhook is down** | Webhook returns non-200, Resend retries | Resend retries webhooks for up to 3 days. Edge function should be idempotent (check `message_id` dedup). No emails are lost. |
| **Supabase edge function cold start** | First request after idle period is slow | Acceptable for this use case — agent replies aren't time-critical down to milliseconds. If needed, add a health check ping via pg_cron. |
| **GTM system user gets deleted** | Properties with no valid `user_id` | Protect the GTM system user: never delete, set `is_admin = true`. Add a startup check in the inbound webhook that verifies the system user exists. |
| **Storage bucket full / quota exceeded** | Upload fails | Supabase Pro plan has generous storage. Monitor usage. For validation phase (5-10/week), storage won't be an issue. |
| **Campaign data out of sync** (status doesn't match reality) | Manual inspection / monitoring | Add a `gtm-monitoring` section to the existing monitoring edge function that checks for: campaigns stuck in `processing` >2 hours, campaigns in `email_sent` >14 days with no reply, orphaned properties with no campaign link. |

---

## Campaign Status State Machine

```
pending
  │
  ├──→ email_sent (outreach email delivered via Instantly)
  │       │
  │       ├──→ bounced (email bounced — terminal)
  │       │
  │       ├──→ replied (agent replied, no PDF attachments)
  │       │       │
  │       │       └──→ disclosures_received (PDFs received in follow-up)
  │       │
  │       └──→ disclosures_received (agent replied with PDFs)
  │               │
  │               └──→ processing (PDFs queued for OCR + AI)
  │                       │
  │                       ├──→ processing_failed (all PDFs failed — needs review)
  │                       │
  │                       └──→ summary_ready (all PDFs processed)
  │                               │
  │                               └──→ review_pending (draft email in review queue)
  │                                       │
  │                                       ├──→ rejected (reviewer rejected — terminal)
  │                                       │
  │                                       └──→ findings_sent (findings email sent)
  │                                               │
  │                                               ├──→ agent_invited (invite created)
  │                                               │       │
  │                                               │       ├──→ invite_expired (7d — terminal)
  │                                               │       │
  │                                               │       └──→ agent_onboarded (agent signed up)
  │                                               │
  │                                               └──→ bounced (findings email bounced — terminal)
  │
  └──→ skipped (no email, duplicate, generic address — terminal)
```

---

## Funnel Metrics to Track

| Metric | Calculation | Target (Validation) |
|--------|-------------|---------------------|
| **Send rate** | emails sent / listings scraped | 60-80% (some won't have emails) |
| **Reply rate** | replies / emails sent | 15-30% (disclosure requests are routine) |
| **Disclosure rate** | PDFs received / replies | 70-90% (if they reply, they usually send) |
| **Processing success** | summaries generated / PDFs received | 95%+ (existing pipeline is reliable) |
| **Findings email open rate** | opens / findings emails sent | 50-70% (they're expecting it) |
| **CTA click rate** | invite clicks / findings emails sent | 20-40% |
| **Signup conversion** | accounts created / invite clicks | 30-50% (value shown before signup) |
| **End-to-end conversion** | agents onboarded / emails sent | 3-8% |

---

## Operational Checklist

### Before First Run
```
[ ] Resend account created
[ ] inbound.discloser.co DNS records configured (MX, SPF, DKIM)
[ ] Resend inbound webhook URL set to edge function
[ ] RESEND_API_KEY added to Supabase Vault (dev)
[ ] GTM system user created in Supabase Auth (dev)
[ ] Database migration applied to dev instance
[ ] gtm-inbound-pdfs storage bucket created (dev)
[ ] Instantly campaign template configured with reply-to field
[ ] Test inbound webhook with sample email + PDF
[ ] Test full pipeline end-to-end with 1 listing
```

### Weekly Operations
```
[ ] Run orchestrator with new listings batch
[ ] Monitor Instantly for bounces and replies
[ ] Check review queue daily — approve/reject pending items
[ ] Review funnel metrics in GTM Hub dashboard
[ ] Adjust email copy based on reply rates
```

### Monthly Review
```
[ ] Analyze conversion funnel drop-off points
[ ] A/B test buyer inquiry email variations
[ ] Review findings email effectiveness (open rate, click rate)
[ ] Assess onboarding completion rate and optimize flow
[ ] Evaluate whether to increase volume beyond 5-10/week
```
