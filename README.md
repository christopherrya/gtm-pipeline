# GTM Pipeline

An open, modular go-to-market pipeline for enriching leads, scoring them against your ICP, orchestrating outbound campaigns, and generating ad creatives at scale. Built for startups and solo founders who want to run sophisticated outbound without paying for enterprise tooling.

Originally built to power [Discloser's](https://discloser.io) outbound engine. Designed to be forked and adapted for any B2B or B2C sales motion.

## What This Does

**You give it a CSV of leads from Clay (or any source). It gives you back scored, enriched leads ready for outbound — and a dashboard to run the whole thing.**

1. **Enrich** — Pulls LinkedIn activity, Instagram engagement, and live brokerage listings for each lead
2. **Score** — Scores every lead against a configurable ICP model (default max: 110 points)
3. **Orchestrate** — 12-node DAG handles deduplication, A/B assignment, suppression, CRM sync, and outbound push
4. **Generate Ads** — Bulk ad creative tool with AI copy, multiple templates, and one-click export

## Who This Is For

- Founders running outbound from Clay/Instantly/Smartlead
- Growth teams that want enrichment beyond what Clay provides natively
- Anyone who wants a local, self-hosted orchestrator instead of paying for Zapier/Make chains
- Teams generating Facebook/Meta ad creatives at volume

## Structure

```
gtm-pipeline/
├── enrichment/             # Lead enrichment scripts
│   ├── enrich-leads.js     # Master pipeline (LinkedIn + IG + listings + scoring)
│   ├── linkedin-enricher.js
│   ├── instagram-enricher.js
│   ├── ai-hooks-generator.js   # AI-written personalization hooks per lead
│   ├── leads-merger.js
│   ├── rescore-leads.js
│   └── brokerage-listings/     # Pluggable listing scrapers
├── orchestrator/           # Local DAG-based lead ops server
│   ├── server.js           # Dashboard + API (localhost:4312)
│   ├── lib/pipeline.js     # 12-node execution graph
│   └── lib/crm/            # CRM connectors (SuiteCRM, extensible)
├── ad-generator/           # Bulk ad creative generator (React/Vite)
│   ├── src/                # Templates, AI editor, preview, export
│   └── server/api.ts       # AI copy generation backend
├── crm/                    # CRM integration docs
├── runbooks/               # Step-by-step operational guides
└── package.json
```

## Quick Start

```bash
git clone https://github.com/christopherrya/gtm-pipeline.git
cd gtm-pipeline
npm install
cp .env.example .env   # add your API keys
```

### Run the enrichment pipeline

```bash
# Test on 10 leads first
npm run enrich -- -i data/1raw/leads.csv --test

# Full run
npm run enrich -- -i data/1raw/leads.csv -r "SF Bay"
```

### Start the orchestrator dashboard

```bash
npm run orchestrator:start   # http://localhost:4312
```

### Start the ad generator

```bash
cd ad-generator && npm install && npm run dev   # http://localhost:3001
```

## Enrichment Pipeline

Takes a Clay CSV and layers on additional signals from LinkedIn, Instagram, and live brokerage listings. Each enricher runs independently and results are merged + scored.

| Command | What It Does |
|---------|-------------|
| `npm run enrich` | Full pipeline — LinkedIn, Instagram, listings, scoring |
| `npm run enrich:linkedin` | Pull recent posts, headline, engagement metrics |
| `npm run enrich:instagram` | Pull posts, captions, location data, engagement |
| `npm run listings:scrape` | Scrape active listings from brokerage sites |
| `npm run listings:match` | Fuzzy-match listings to leads (85% threshold) |
| `npm run hooks:extract` | Generate AI personalization hooks per lead |
| `npm run rescore` | Recalculate ICP scores after new data |
| `npm run merge` | Merge all enrichment sources into final output |

**Adapting for your use case:** The brokerage listing scrapers are real estate-specific. Swap them out for scrapers relevant to your vertical — the enrichment pipeline treats them as pluggable data sources.

## Orchestrator

A local 12-node DAG that takes leads from raw CSV through to CRM upsert and outbound push. Includes a browser-based dashboard for running pipelines, viewing node reports, and managing state.

```
N01 Clay Upload Ingest
 └─> N02 Brokerage Scrape
      └─> N03 Normalize Records
           └─> N04 Dedupe Listings
                └─> N05 Contact Join
                     └─> N06 Trigger Scoring
                          └─> N07 A/B Variant Assignment
                               └─> N08 Suppression Filter
                                    └─> N09 Trigger Queue Export
                                         └─> N10 CRM Upsert
                                              └─> N11 Instantly Push
                                                   └─> N12 Run Reports
```

Features:
- Run the full DAG, dry-run, or start from any node
- Per-run artifacts and reports stored locally
- CRM provider abstraction (local mirror or SuiteCRM — add your own)
- Instantly safety flags for email warmup periods
- Event endpoints for webhooks and manual requeue

## Ad Generator

A React/Vite app for generating Facebook ad creatives in bulk. Includes multiple templates (hero, feature, CTA, testimonial, stats, minimal), AI-assisted copy editing, variant generation, and export.

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `APIFY_API_KEY` | LinkedIn, Instagram, and Compass enrichment via Apify | required |
| `CRM_PROVIDER` | CRM backend — `local` for file-based, `suitecrm` for SuiteCRM API | `local` |
| `CRM_DRY_RUN` | Prevent real CRM writes during testing | `true` |
| `INSTANTLY_ENABLED` | Enable outbound push to Instantly | `false` |
| `INSTANTLY_SHADOW_MODE` | Log sends without actually pushing | `true` |

## Runbooks

Detailed operational guides live in `runbooks/`:

- **[Monthly Enrichment](runbooks/monthly-enrichment.md)** — End-to-end guide for monthly lead processing
- **[ICP Scoring](runbooks/icp-scoring.md)** — Scoring model breakdown and tuning
- **[Listings Scraper](runbooks/listings-scraper.md)** — Brokerage scraper setup and scheduling
- **[Orchestrator](runbooks/orchestrator.md)** — DAG operations and CRM sync

## License

MIT
