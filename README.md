# GTM Pipeline

Internal go-to-market automation for Discloser. Handles lead enrichment, ICP scoring, outbound orchestration, CRM sync, and ad creative generation.

## Structure

```
gtm-pipeline/
├── enrichment/             # Lead enrichment scripts
│   ├── enrich-leads.js     # Master enrichment pipeline
│   ├── linkedin-enricher.js
│   ├── instagram-enricher.js
│   ├── ai-hooks-generator.js
│   ├── leads-merger.js
│   ├── rescore-leads.js
│   └── brokerage-listings/ # Listing scrapers + matching
├── orchestrator/           # DAG-based lead ops (N01-N12)
│   ├── server.js           # HTTP server (localhost:4312)
│   ├── lib/pipeline.js     # Node graph execution
│   └── lib/crm/            # CRM connectors (SuiteCRM)
├── ad-generator/           # Bulk ad creative generator (React/Vite)
│   ├── src/                # Templates, editor, preview, export
│   └── server/api.ts       # AI copy generation backend
├── crm/                    # CRM infrastructure docs
├── runbooks/               # Operational runbooks
│   ├── monthly-enrichment.md
│   ├── icp-scoring.md
│   ├── listings-scraper.md
│   └── orchestrator.md
└── package.json
```

## Enrichment Pipeline

Enriches Clay-exported leads with LinkedIn activity, Instagram engagement, and brokerage listing data, then scores them against the ICP model (max 110 points).

```bash
npm run enrich -- -i data/1raw/leads.csv --test   # test on 10 leads
npm run enrich -- -i data/1raw/leads.csv -r "SF Bay"  # full run
```

Individual steps:

| Command | Description |
|---------|-------------|
| `npm run enrich:linkedin` | LinkedIn profile + posts enrichment |
| `npm run enrich:instagram` | Instagram posts enrichment |
| `npm run listings:scrape` | Scrape brokerage listings (Compass, Coldwell Banker, Sotheby's, Intero) |
| `npm run listings:match` | Fuzzy-match listings to leads |
| `npm run hooks:extract` | AI-generated personalization hooks |
| `npm run rescore` | Recalculate ICP scores |
| `npm run merge` | Merge enrichment sources |

## Orchestrator

12-node DAG that takes leads from Clay CSV through to CRM upsert and outbound push.

```bash
npm run orchestrator:start   # http://localhost:4312
```

Nodes: `N01_ClayUploadIngest` -> `N02_BrokerageScrape` -> `N03_NormalizeRecords` -> `N04_DedupeListings` -> `N05_ContactJoin` -> `N06_TriggerScoring` -> `N07_ABVariantAssignment` -> `N08_SuppressionFilter` -> `N09_TriggerQueueExport` -> `N10_CrmUpsert` -> `N11_InstantlyPush` -> `N12_RunReports`

## Ad Generator

Bulk Facebook ad creative tool with AI-assisted copy, multiple templates, variant generation, and export.

```bash
cd ad-generator && npm install && npm run dev   # http://localhost:3001
```

## Setup

```bash
npm install
cp .env.example .env   # add API keys
```

Required environment variables:
- `APIFY_API_KEY` — for LinkedIn/Instagram/Compass enrichment
- `CRM_PROVIDER` — `local` or `suitecrm`
- `INSTANTLY_ENABLED` — `false` during warmup
