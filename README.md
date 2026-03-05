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
├── scripts/                # Mass outreach pipeline (Twenty CRM → Instantly)
│   ├── setup-twenty-fields.js      # Create custom CRM fields
│   ├── bulk-import-twenty.js       # Batch import 15k contacts to Twenty
│   ├── select-from-pool.js         # Select leads from contact pool
│   ├── prepare-batch.js            # Query CRM, assign A/B, output CSV
│   ├── personalize-batch.js        # LLM-powered email personalization
│   ├── push-to-instantly.js        # Push to Instantly campaigns
│   ├── setup-instantly-campaigns.js # Configure campaign sequences
│   ├── sync-status.js              # Poll Instantly → update CRM stages
│   └── lib/
│       ├── twenty-client.js        # Twenty CRM API client
│       ├── constants.js            # Tiers, regions, funnel stages
│       ├── llm-client.js           # Claude API wrapper + cost tracking
│       ├── content-filter.js       # Recency/relevance gates + pattern assignment
│       └── prompt-templates.js     # System prompt, validation, fallbacks
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
│   └── lib/crm/            # CRM connectors (Twenty CRM, extensible)
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

### Start everything

```bash
npm run orchestrator:start # Orchestrator → http://localhost:4312
```

### Run the enrichment pipeline

```bash
# Test on 10 leads first
npm run enrich -- -i data/1raw/leads.csv --test

# Full run
npm run enrich -- -i data/1raw/leads.csv -r "SF Bay"
```

## Mass Outreach Pipeline

The `scripts/` directory contains a complete outbound pipeline: import leads to Twenty CRM, prepare batches, personalize with Claude, push to Instantly, and sync statuses back.

```
prepare-batch.js  →  personalize-batch.js  →  push-to-instantly.js  →  sync-status.js
   (CRM query)        (Claude LLM hooks)       (Instantly push)       (status sync)
```

### LLM Email Personalization

Hot/High ICP leads get Claude-powered personalized subject lines and hooks. The system uses three rotating patterns (A: The Moment, B: The Peer Observation, C: The Specific Question) with conflict resolution so agents at the same brokerage never get the same pattern.

```bash
# Dry run — eligibility report + cost estimate, no API calls
node scripts/personalize-batch.js batch.csv --dry-run

# Test — process only first 5 eligible leads
node scripts/personalize-batch.js batch.csv --test

# Full run with custom budget cap
node scripts/personalize-batch.js batch.csv --max-cost 15.00
```

Medium/Low tier leads automatically receive rule-based fallback hooks. Budget cap ($10 default) prevents runaway costs — remaining leads get fallbacks if budget is exceeded.

| Command | What It Does |
|---------|-------------|
| `node scripts/setup-twenty-fields.js` | Create 31 custom CRM fields on Twenty People |
| `node scripts/bulk-import-twenty.js <csv>` | Batch import contacts to Twenty CRM |
| `node scripts/prepare-batch.js --region "SF Bay"` | Query CRM, assign A/B variants, output CSV |
| `node scripts/personalize-batch.js <csv>` | LLM personalization for Hot/High leads |
| `node scripts/push-to-instantly.js <csv>` | Push to Instantly campaigns |
| `node scripts/sync-status.js` | Poll Instantly, update CRM funnel stages |

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
- CRM provider abstraction (local mirror or Twenty CRM — add your own)
- Instantly safety flags for email warmup periods
- Event endpoints for webhooks and manual requeue

## Ad Generator

A React/Vite app for generating Facebook ad creatives in bulk. Includes multiple templates (hero, feature, CTA, testimonial, stats, minimal), AI-assisted copy editing, variant generation, and export.

## Configuration

**Enrichment & Orchestrator** (root `.env`):

| Variable | Purpose | Default |
|----------|---------|---------|
| `APIFY_API_KEY` | LinkedIn, Instagram, and Compass enrichment via Apify | required |
| `ANTHROPIC_API_KEY` | Claude API — powers LLM email personalization | required for personalization |
| `CRM_PROVIDER` | CRM backend — `local` for file-based, `twenty` for Twenty CRM API | `local` |
| `CRM_DRY_RUN` | Prevent real CRM writes during testing | `true` |
| `INSTANTLY_ENABLED` | Enable outbound push to Instantly | `false` |
| `INSTANTLY_SHADOW_MODE` | Log sends without actually pushing | `true` |

**Ad Generator** (`ad-generator/.env`):

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API — powers AI ad copy generation |
| `GOOGLE_AI_API_KEY` | Google Gemini API — powers AI image generation |

## Runbooks

Detailed operational guides live in `runbooks/`:

- **[Monthly Enrichment](runbooks/monthly-enrichment.md)** — End-to-end guide for monthly lead processing
- **[ICP Scoring](runbooks/icp-scoring.md)** — Scoring model breakdown and tuning
- **[Listings Scraper](runbooks/listings-scraper.md)** — Brokerage scraper setup and scheduling
- **[Mass Email Pipeline](runbooks/mass_email_pipeline.md)** — CRM import, batch prep, LLM personalization, Instantly push
- **[Orchestrator](runbooks/orchestrator.md)** — DAG operations and CRM sync

## License

MIT
