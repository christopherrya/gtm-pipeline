# GTM Warehouse

Data warehouse for the GTM pipeline. Unifies Facebook Ads, Google Search Console, Instantly email analytics, and enrichment pipeline data into a single queryable DuckDB warehouse with an MCP interface for Claude.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Facebook Ads │     │     GSC      │     │  Instantly   │     │   Pipeline   │
│  Marketing   │     │  Search API  │     │   API v2     │     │   Outputs    │
│   API v21    │     │              │     │              │     │  (CSV/JSON)  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       ▼                    ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Python Ingestion Scripts                             │
│                    (warehouse/ingest/run_all.py)                            │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │  Landing Zone (CSV/JSON)  │
                    │  warehouse/data/landing/  │
                    └──────────┬───────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           dbt + DuckDB                                      │
│                                                                             │
│  ┌─────────┐  ┌─────┐  ┌─────────┐  ┌────────────┐  ┌───────────┐  ┌────┐ │
│  │ Ingress │→ │ Raw │→ │ Staging │→ │ Analytical │→ │Operational│→ │Rpt │ │
│  │ (copy)  │  │(dup)│  │ (xform) │  │ (derived)  │  │  (KPIs)   │  │    │ │
│  └─────────┘  └─────┘  └─────────┘  └────────────┘  └───────────┘  └────┘ │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │   MCP Server (stdio)      │
                    │ warehouse/mcp/server.py   │
                    │                           │
                    │ Tools:                    │
                    │  • query_warehouse        │
                    │  • list_tables            │
                    │  • describe_table         │
                    │  • get_semantic_layer     │
                    │  • sample_data            │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │  Claude (Code/iOS/Web)    │
                    │                           │
                    │ "Which ads should I       │
                    │  turn off?"               │
                    │ "What content needs       │
                    │  refreshing?"             │
                    └──────────────────────────┘
```

## Setup

```bash
cd warehouse
pip install -r requirements.txt
make setup
```

### Environment Variables

```bash
# Facebook Ads
FB_APP_ID=
FB_APP_SECRET=
FB_ACCESS_TOKEN=
FB_AD_ACCOUNT_ID=act_XXXXXXXXX

# Google Search Console
GSC_CREDENTIALS_PATH=/path/to/service-account.json
GSC_SITE_URL=https://yoursite.com

# Instantly
INSTANTLY_API_KEY=
```

## Usage

### Full pipeline run

```bash
make full-refresh   # ingest all → dbt run → dbt test
```

### Individual steps

```bash
make ingest              # all sources
make ingest-fb           # facebook only
make ingest-gsc          # gsc only
make ingest-instantly    # instantly only
make ingest-pipeline     # local pipeline outputs only

make dbt-run             # run all dbt models
make dbt-run-staging     # run staging layer only
make dbt-test            # run dbt tests
make dbt-docs            # generate + serve docs on :8081
```

### MCP Server

Add to Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "gtm-warehouse": {
      "command": "python",
      "args": ["-m", "mcp.server"],
      "cwd": "/path/to/gtm-pipeline/warehouse"
    }
  }
}
```

Then ask Claude: "Which Facebook ads should I turn off?" and it queries the warehouse directly.

## Data Layers

| Layer | Schema | Materialization | Purpose |
|-------|--------|-----------------|---------|
| Ingress | `ingress` | table | Raw copy of landing zone files |
| Raw | `raw` | table | Deduplicated via `dedup()` macro |
| Staging | `staging` | view | Type casts, renames, cleaning |
| Analytical | `analytical` | table | Derived fields, rolling averages, trends |
| Operational | `operational` | table | Actionable KPIs (ads to pause, content to refresh) |
| Reporting | `reporting` | table | Dashboard-ready aggregations |

## Key Models

| Model | Question it answers |
|-------|-------------------|
| `opr_underperforming_ads` | Which Facebook ads should I pause? |
| `opr_content_refresh_candidates` | Which pages need content refresh? |
| `opr_email_campaign_health` | Are my email campaigns healthy? |
| `rpt_ad_performance_daily` | Campaign-level daily ad performance |
| `rpt_seo_content_health` | Top pages ranked by traffic + trends |
| `rpt_email_outreach_daily` | Daily email send/open/reply volumes |
| `rpt_lead_funnel` | Lead funnel: Total → Emailed → Opened → Replied → Interested |
