# Brokerage Listings Scraper Runbook

## Overview

The brokerage listings scraper extracts active property listings from four major Northern California brokerages and cross-references agent names with the lead database to enrich leads with RECENCY and VOLUME signals.

---

## Data Sources

| Brokerage | Scraper Type | Coverage |
|-----------|--------------|----------|
| **Compass** | Apify actor (`mosaic/compass-scraper`) | SF, Oakland, Palo Alto, San Jose, Berkeley, Marin, Menlo Park, Atherton, Los Altos, Saratoga, Walnut Creek |
| **Coldwell Banker** | Custom Puppeteer | Same NorCal areas |
| **Sotheby's** | Custom Puppeteer | Same NorCal areas + Tiburon, Ross |
| **Intero** | Custom Puppeteer | SF, Oakland, Palo Alto, San Jose, Los Gatos, Saratoga, Cupertino, Campbell, Sunnyvale, Mountain View, Santa Clara, Fremont |

---

## File Structure

```
GTM/enrichment/brokerage-listings/
├── listings-scraper.js      # Master orchestrator
├── scrapers/
│   ├── compass-scraper.js   # Uses mosaic/compass-scraper Apify actor
│   ├── coldwell-scraper.js  # Custom Puppeteer
│   ├── sothebys-scraper.js  # Custom Puppeteer
│   └── intero-scraper.js    # Custom Puppeteer
├── listings-matcher.js      # Cross-references with lead DB
└── listings-scorer.js       # Calculates RECENCY + VOLUME scores

GTM/data/2listings/          # Scraped listing data
├── compass-listings-{date}.json
├── coldwell-listings-{date}.json
├── sothebys-listings-{date}.json
├── intero-listings-{date}.json
└── all-listings-{date}.json
```

---

## Listing Data Schema

```javascript
{
  listing_id: "compass-12345",      // Unique ID per source
  source: "compass",                // compass | coldwell_banker | sothebys | intero
  address: "123 Main St",
  city: "San Francisco",
  state: "CA",
  zip: "94102",
  price: 1500000,
  agent_name: "Jane Smith",
  agent_email: "jane@compass.com",  // May be empty
  brokerage: "Compass",
  listing_date: "2026-02-01",       // ISO date
  days_on_market: 5,
  status: "active",                 // active | pending | sold
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1800,
  listing_url: "https://...",
  scraped_at: "2026-02-05T10:30:00Z"
}
```

---

## Quick Start

### 1. Install Dependencies

```bash
cd GTM
npm install
```

This installs `puppeteer` and `string-similarity` packages.

### 2. Test Run (50 listings per source)

```bash
npm run listings:scrape:test
```

### 3. Full Scrape (all sources)

```bash
npm run listings:scrape
```

### 4. Scrape Single Source

```bash
node enrichment/brokerage-listings/listings-scraper.js --source compass
node enrichment/brokerage-listings/listings-scraper.js --source coldwell_banker
node enrichment/brokerage-listings/listings-scraper.js --source sothebys
node enrichment/brokerage-listings/listings-scraper.js --source intero
```

---

## Matching Listings to Leads

### Step 1: Scrape Listings

```bash
npm run listings:scrape
# Output: GTM/data/2listings/all-listings-2026-02-05.json
```

### Step 2: Match to Lead Database

```bash
npm run listings:match -- \
  --leads data/1raw/sf-feb-2026.csv \
  --listings data/2listings/all-listings-2026-02-05.json

# Output: GTM/data/1raw/sf-feb-2026-matched.csv
```

### Step 3: Run Full Enrichment Pipeline

```bash
npm run enrich -- --input data/1raw/sf-feb-2026-matched.csv --region "SF Bay"
```

---

## Matching Algorithm

The matcher uses **fuzzy name matching** to handle variations in agent names:

1. **Name normalization**: Removes titles (Jr., Sr., etc.), lowercases, trims
2. **Weighted similarity**: Last name (60%) + First name (40%)
3. **Company boost**: +10% if company names match
4. **Threshold**: 85% similarity required for match

```javascript
// Example matches that pass 85% threshold:
"Michael Tessaro" → "Michael J. Tessaro"     ✅ 92%
"Mary Lou Castellanos" → "Mary Castellanos"   ✅ 88%
"Julie Sinner" → "Julie Sinner-Smith"         ✅ 86%

// Example that fails:
"John Smith" → "John Johnson"                 ❌ 62%
```

---

## Scoring Integration

Matched listings add up to **30 points** to the ICP score:

### RECENCY Score (max 15 points)

| Days Since Listing | Points |
|-------------------|--------|
| ≤7 days | +15 |
| ≤14 days | +12 |
| ≤30 days | +8 |
| ≤60 days | +4 |
| >60 days | 0 |

### VOLUME Score (max 15 points)

| Active Listings | Points |
|-----------------|--------|
| 5+ | +15 |
| 3-4 | +10 |
| 2 | +6 |
| 1 | +3 |
| 0 | 0 |

---

## New Lead Fields

After matching, leads have these new columns:

| Column | Example |
|--------|---------|
| `listings_matched` | "Yes" |
| `listings_count` | 3 |
| `listings_most_recent_date` | "2026-02-03" |
| `listings_days_since_most_recent` | 2 |
| `listings_addresses` | "123 Main St \| 456 Oak Ave" |
| `listings_total_value` | 4500000 |
| `listings_avg_price` | 1500000 |
| `listings_recency_score` | 15 |
| `listings_volume_score` | 10 |

---

## Personalization Hook Ideas

Use matched listings data for high-priority hooks:

1. **Recent listing address**
   > "I saw your listing at {address} just hit the market - curious how you typically handle disclosure complexity on properties like that?"

2. **High volume**
   > "With {count} active listings, disclosure efficiency must really matter to your workflow - that's a lot of paperwork per month."

3. **Luxury listings**
   > "Luxury listings at ${avgPrice}M+ demand premium presentation - disclosures included."

---

## Monthly Workflow

### Week 1: Scrape + Match

```bash
# 1. Run full scrape
npm run listings:scrape

# 2. Match to latest Clay export
npm run listings:match -- \
  --leads data/1raw/sf-feb-2026.csv \
  --listings data/2listings/all-listings-$(date +%Y-%m-%d).json

# 3. Run enrichment
npm run enrich -- --input data/1raw/sf-feb-2026-matched.csv --region "SF Bay"
```

### Week 2-4: Re-scrape for freshness

```bash
# Re-scrape to catch new listings
npm run listings:scrape

# Re-match existing leads (updates recency scores)
npm run listings:match -- \
  --leads data/3operational/sf-feb-2026/enriched-full.csv \
  --listings data/2listings/all-listings-$(date +%Y-%m-%d).json
```

---

## Estimated Costs

| Item | Monthly Cost |
|------|--------------|
| Compass scraper (Apify `mosaic/compass-scraper`) | ~$35-40 |
| Apify compute for custom scrapers | ~$20-30 |
| **Total** | **~$60-70/month** |

---

## Troubleshooting

### Compass scraper fails

Check Apify API key:
```bash
echo $APIFY_API_KEY
# Should be set in GTM/.env
```

### Puppeteer crashes on custom scrapers

Increase memory or run with `--headless=false` to debug:
```bash
# In scraper file, change:
headless: false  # Shows browser window
```

### Low match rate (<10%)

1. Check name formatting in Clay export
2. Lower `MATCH_THRESHOLD` in `listings-matcher.js` (default: 0.85)
3. Review unmatched agents manually

### Missing listing dates

Some scrapers can't extract listing dates. The matcher uses `days_on_market` as a fallback to estimate dates.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-05 | Initial brokerage listings scraper implementation |
| 2026-02-05 | Added Compass, Coldwell Banker, Sotheby's, Intero scrapers |
| 2026-02-05 | Integrated RECENCY + VOLUME scoring into ICP system |
