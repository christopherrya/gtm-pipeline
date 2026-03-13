# Runbooks

Runbooks are organized by subject so the cold outreach system, enrichment workflows, and infrastructure docs are easy to scan.

## Cold Outreach

- [Mass Email Pipeline](./cold-outreach/mass_email_pipeline.md) — Authoritative Bucket 1 architecture reference
- [Pipeline Status](./cold-outreach/pipeline-status.md) — Current live state, automation schedule, and handoff notes
- [Pipeline Current State](./cold-outreach/pipeline-current-state.md) — SQLite cutover, manifests, and execution modes
- [Product-Led Outreach](./cold-outreach/product-led-outreach.md) — Listing-based outreach motion tied to disclosure workflows
- [Instantly API Notes](./cold-outreach/instantly-v1-v2-api.md) — API migration and integration details
- [Product Spec](./cold-outreach/product-spec.md) — Master doc for the CLI-accessible cold outreach pipeline

## Lead Enrichment

- [Monthly Enrichment](./lead-enrichment/monthly-enrichment.md) — Monthly lead processing workflow
- [ICP Scoring](./lead-enrichment/icp-scoring.md) — Scoring model and tuning logic
- [Listings Scraper](./lead-enrichment/listings-scraper.md) — Brokerage scraping setup and scheduling

## Infrastructure

- [Orchestrator](./infrastructure/orchestrator.md) — Orchestrator DAG and CRM sync
- [SQLite Data Layer](./infrastructure/sqlite-data-layer.md) — Operational schema, indexes, and state model

## Scaled Creative Generation

- [Ad Generator README](../ad-generator/README.md) — Creative generation app docs live with the codebase rather than under `runbooks/`
