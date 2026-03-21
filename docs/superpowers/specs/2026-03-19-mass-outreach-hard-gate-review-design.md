# Mass Outreach Hard-Gate Review Design

**Date:** 2026-03-19
**Status:** Proposed

## Goal

Fix broken personalization variable population in the mass outreach pipeline and add a hard approval gate that exports personalization inputs and campaign-path metadata to Google Sheets before any lead can be pushed into Instantly.

## Context

The current mass outreach flow is:

`prepare-batch -> personalize-batch -> push-to-instantly`

Two issues now block reliable scaling into brokerage outreach:

1. Personalization variables used in Instantly email templates are not populating reliably. The observed symptom is that even `first_name` did not appear in outbound emails.
2. There is no pre-send review layer showing the lead data and sequence path that will drive personalization across the campaign before release into Instantly.

SQLite should remain the operational source of truth. Google Sheets should become the human review surface, not the primary datastore.

## Problem Summary

### Personalization integrity risk

The current campaign templates in `scripts/setup-instantly-campaigns.js` use merge variables such as:

- `{{firstName}}`
- `{{hookText}}`
- `{{greetingLine}}`
- `{{company}}`

The current Instantly push payload in `scripts/push-to-instantly.js` sends:

- top-level `first_name`, `last_name`, `company_name`
- custom variables primarily in snake_case, such as `hook_text`, `personalized_hook`, and `greeting_line`

That creates a contract mismatch between template variables and payload variable names. Even when the data exists in SQLite and the batch CSV, Instantly cannot populate variables consistently if the names do not match what the campaign copy references.

### Review gap

The current pipeline has no hard release gate between personalization and Instantly push. That means:

- operators cannot inspect the personalization-driving fields before launch
- bad or blank personalization values can flow into Instantly unnoticed
- there is no per-lead approval state enforced by the pipeline

## Non-Goals

- Do not make Google Sheets the operational source of truth
- Do not require email-copy editing in Google Sheets
- Do not redesign the brokerage outreach copy in this spec
- Do not replace SQLite with Supabase or another review store

## Recommended Approach

Use SQLite as the system of record, add a Google Sheets review snapshot as a hard gate, and require approval state to be synced back into SQLite before `push-to-instantly.js` can send.

Updated flow:

`prepare-batch -> personalize-batch -> export-review-sheet -> sync-review-approvals -> push-to-instantly`

## Architecture

### 1. Canonical personalization contract

Define one canonical set of personalization fields that are used consistently across:

- SQLite storage
- batch CSV output
- personalization output
- Google Sheets export
- Instantly custom variables
- pre-push validation

This contract should include both:

- source fields from SQLite, such as `first_name`, `company_name`, `hook_text`, `linkedin_headline`
- resolved merge variables used by campaign templates, such as `firstName`, `company`, `hookText`, `greetingLine`

The pipeline should generate the merge-variable map from the SQLite-backed fields rather than hand-assembling different names in different scripts.

### 2. Google Sheets as review surface

Add a new script that exports review rows for a send run to Google Sheets. The sheet should show the personalization-driving fields and campaign path for each lead, not the literal email copy.

Each row should include:

- lead identity: `email`, `first_name`, `last_name`, `company_name`, `region`
- campaign routing: `mode`, `icp_tier`, `abVariant`, `testName`, resolved campaign label, resolved campaign id if available
- personalization source fields: `hook_text`, `hook_source`, `ig_username`, `ig_followers`, `linkedin_headline`, `linkedin_recent_topic`, `linkedin_days_since_post`, `ig_recent_addresses`, `ig_neighborhoods`, `ig_days_since_post`, `ig_listing_posts`, `ig_sold_posts`, `icp_score`
- resolved merge variables: `firstName`, `lastName`, `company`, `hookText`, `greetingLine`, `personalizedSubject`, `personalizedHook`
- sequence path metadata: campaign type, expected sequence length, sequence family
- review metadata: `review_key`, `run_id`, `batch_name`, `exported_at`, `approval_status`, `approved_by`, `approved_at`, `hold_reason`, `rejection_reason`
- traceability: `twentyId` or SQLite lead id

### 3. SQLite-enforced approval state

Google Sheets is where humans review and mark decisions, but SQLite enforces release.

Add review-state columns to SQLite for each lead/run combination, or to a dedicated review table keyed by `review_key`. The approval model must support:

- `pending`
- `approved`
- `hold`
- `rejected`

The pipeline should export rows with `pending` status by default. A sync step then reads the Google Sheet and writes the reviewed states back into SQLite. `push-to-instantly.js` must reject any lead that is not explicitly approved for the current run.

### 4. Hard gate behavior

The push step must refuse to send leads unless all of the following are true:

- the lead belongs to the current reviewed batch
- the lead has a valid `review_key`
- the lead has `approval_status = approved`
- the lead passes personalization validation
- the lead resolves to a valid Instantly campaign

Leads in `pending`, `hold`, or `rejected` must not be pushed.

## Data Model

### Option A: dedicated review table in SQLite

Recommended.

Add a table such as `outreach_review_queue` with one row per lead per review run. Fields:

- `review_key`
- `run_id`
- `lead_id`
- `email`
- `campaign_label`
- `approval_status`
- `approved_by`
- `approved_at`
- `hold_reason`
- `rejection_reason`
- `sheet_row_id`
- `exported_at`
- `synced_at`

Benefits:

- approval history is separated from lead master data
- one lead can appear in multiple review runs safely
- the pipeline can audit exactly what was reviewed for each launch

### Option B: add approval fields directly to `leads`

Simpler, but weaker. This couples transient review state to the lead record and makes reruns and auditability harder.

Choose Option A.

## Personalization Validation

Add a shared validator used by both sheet export and Instantly push.

Validation should check:

- required identity fields: `email`, `first_name`
- campaign resolution fields: `icp_tier`, `abVariant`, `mode`
- required personalization fields per campaign family
- resolved merge variables are present and non-empty where required

Validation output should classify rows into:

- `sendable`
- `blocked_missing_required_field`
- `blocked_unapproved`
- `blocked_missing_campaign`
- `blocked_invalid_personalization`

The export step should surface validation errors in the sheet so issues are visible before approval.

## Sequence Visibility

The review sheet must show all personalization-driving inputs for all sequences the lead will traverse in the campaign, not just email one.

This does not mean storing the literal copy of every email body in the sheet. It means the reviewer can see:

- which campaign/sequence the lead will enter
- how many touches that sequence contains
- which merge-variable values will be used throughout the sequence

For current first-touch campaigns, this mostly means one set of merge variables reused across the sequence. The sheet should make that explicit so the same review framework can support brokerage campaigns later.

## Component Changes

### `scripts/setup-instantly-campaigns.js`

- Stop relying on variable names that do not exist in the push payload
- Standardize template merge variables against the canonical personalization contract
- Prefer one naming convention across all templates

### `scripts/push-to-instantly.js`

- Build Instantly `custom_variables` from the canonical merge-variable map
- Validate rows before push
- Enforce approval gating from SQLite review state
- Emit clear summary counts for approved, held, rejected, pending, invalid, and pushed rows

### `scripts/prepare-batch.js`

- Preserve all fields required for personalization and review export
- Ensure run metadata is available for downstream review rows

### `scripts/personalize-batch.js`

- Continue generating `personalized_subject` and `personalized_hook`
- Normalize output into the canonical merge-variable map used by export and push

### New script: `scripts/export-review-sheet.js`

Responsibilities:

- read the prepared/personalized batch
- resolve campaign labels and merge variables
- validate personalization inputs
- write review rows to Google Sheets
- write matching review rows into SQLite with `pending` status

### New script: `scripts/sync-review-approvals.js`

Responsibilities:

- read review decisions from Google Sheets
- validate `review_key` and row integrity
- sync approval states back into SQLite
- report changed rows and conflicts

## Operational Flow

1. Run batch preparation
2. Run personalization
3. Export reviewed batch to Google Sheets
4. Human reviews rows and marks each as `approved`, `hold`, or `rejected`
5. Sync review decisions back into SQLite
6. Run push; only approved rows are eligible
7. Push summary reports blocked vs sent rows

## Error Handling

- If Google Sheets export fails, no review rows are created in SQLite and no push is allowed
- If approval sync fails, push is blocked
- If a review row exists in SQLite but is missing in the sheet, keep it `pending`
- If the sheet row is edited manually in a way that breaks required identifiers, mark it invalid and block push
- If campaign resolution fails, surface that in the sheet and block approval or push

## Testing Strategy

### Unit tests

- merge-variable mapping from SQLite lead data
- validator behavior for missing `first_name`, missing `hook_text`, unresolved campaign labels
- approval-state enforcement in push logic

### Integration tests

- prepare -> personalize -> export review rows -> sync approvals -> push only approved rows
- mixed approval states in a single batch
- regression test for `first_name` and `hook_text` being available under the exact template variable names used in campaigns

### Operational verification

- dry-run export produces the expected sheet columns
- approval sync changes SQLite state as expected
- push dry-run reports blocked unapproved rows and only approved sendable rows

## Rollout Plan

### Phase 1

- fix personalization variable-name mismatch
- add shared merge-variable builder
- add shared validation

### Phase 2

- add review table in SQLite
- add Google Sheets export script
- add approval sync script

### Phase 3

- hard-gate `push-to-instantly.js`
- add reporting and runbook updates

## Risks

- manual edits in Google Sheets can drift from exported values; use immutable identifiers and sync only review-state fields back
- old campaigns in Instantly may still contain stale merge-variable names; campaign recreation or patching may be required
- reruns can create duplicate review rows unless run ids and review keys are stable

## Open Decisions Resolved

- Google Sheets is a hard gate, not just a visibility layer
- The sheet shows personalization inputs and campaign path, not literal email copy
- SQLite remains the source of truth for release enforcement

## Recommendation

Implement the hard-gate review layer using a dedicated SQLite review table plus Google Sheets export/sync scripts, and fix the Instantly merge-variable contract first. That solves the current mass outreach failure mode and creates a reusable review-and-approval pattern for the brokerage outreach pipeline.
