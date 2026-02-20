# Monthly Lead Enrichment Runbook

## Quick Start

```bash
cd GTM

# 1. Place Clay export in data/1raw/
#    Naming: {region}-{month}-{year}.csv
#    Example: sf-bay-feb-2026.csv

# 2. Test on 10 leads first
npm run enrich -- -i data/1raw/sf-bay-feb-2026.csv --test

# 3. Full run
npm run enrich -- -i data/1raw/sf-bay-feb-2026.csv -r "SF Bay"
```

## Clay Export Template

Export exactly these columns from Clay:

| Column | Required | Description |
|--------|----------|-------------|
| `First Name` | Yes | For personalization |
| `Last Name` | Yes | For personalization |
| `Email` or `Work Email` | Yes | For outreach |
| `LinkedIn Profile` | Yes | Full URL to profile |
| `Company Name` | Optional | For company-based hooks |
| `IG handle` | Optional | URL or @username |

Save template in Clay as "Discloser GTM Export" for consistency.

## Monthly Checklist

```
[ ] Export leads from Clay using template
[ ] Save to GTM/data/1raw/{region}-{month}-{year}.csv
[ ] Run test: npm run enrich -- -i data/1raw/{file}.csv --test
[ ] Review test output in data/3operational/{file}/summary.txt
[ ] Run full: npm run enrich -- -i data/1raw/{file}.csv -r "{Region}"
[ ] Generate AI hooks for hot leads (see below)
[ ] Review ICP distribution in summary.txt
[ ] Upload segments to Instantly:
    [ ] segment-hot.csv → Immediate outreach (90+ score)
    [ ] segment-high-icp.csv → Priority campaign (70-89)
    [ ] segment-in-contract.csv → Urgency campaign
    [ ] segment-active-listers.csv → Listing-focused
[ ] Archive raw file
```

## Output Structure

```
GTM/data/3operational/{filename}/
├── enriched-full.csv           # All leads, all data
├── segment-hot.csv             # ICP 90+ (in-contract + active)
├── segment-high-icp.csv        # ICP 70-89
├── segment-medium-icp.csv      # ICP 55-69
├── segment-in-contract.csv     # Transaction urgency detected
├── segment-active-listers.csv  # 2+ listing posts
├── segment-recent-closers.csv  # Recent sold posts
├── segment-high-followers.csv  # 1k+ IG followers
├── segment-linkedin-active.csv # 3+ LinkedIn posts
└── summary.txt                 # Stats and top leads
```

## Command Reference

```bash
# Full pipeline (LinkedIn + Instagram + scoring + segments)
npm run enrich -- -i data/1raw/file.csv

# Test mode (10 leads only)
npm run enrich -- -i data/1raw/file.csv --test

# With region name
npm run enrich -- -i data/1raw/file.csv -r "East Bay"

# Custom limit
npm run enrich -- -i data/1raw/file.csv --limit 50

# Skip one source
npm run enrich -- -i data/1raw/file.csv --skip-instagram
npm run enrich -- -i data/1raw/file.csv --skip-linkedin
```

## Cost Estimates

| Leads | LinkedIn | Instagram | Total |
|-------|----------|-----------|-------|
| 10 (test) | $0.02 | $0.003 | ~$0.02 |
| 100 | $0.20 | $0.03 | ~$0.23 |
| 500 | $1.00 | $0.13 | ~$1.13 |
| 1000 | $2.00 | $0.25 | ~$2.25 |

## ICP Scoring System

See **[icp-scoring.md](./icp-scoring.md)** for complete scoring documentation.

**Formula:**
```
ICP Score = Clay Baseline (50)
          + LinkedIn Activity (0-15)
          + Instagram Activity (0-15)
          + Transaction Urgency (0-20)
          + Recency Bonus (-10 to +10)

Max: 110 points
```

**Tier Thresholds:**

| Tier | Score | Action |
|------|-------|--------|
| **Hot** | 90+ | Immediate outreach (in-contract) |
| **High** | 70-89 | Priority outreach within 48h |
| **Medium** | 55-69 | Standard campaign |
| **Low** | <55 | Nurture only |

**Key Signals:**
- Transaction urgency (in-contract detected): +15 points
- Recent post (within 3 days): +10 points
- Inactive 90+ days: -10 points

## Hook Scoring System

Hooks are selected using a scoring formula that combines **specificity** and **recency**:

```
Final Score = Base Specificity + Recency Bonus
(Higher score wins - consistent with ICP scoring)
```

### Base Specificity (Higher = Better)

| Base | Source | Trigger |
|------|--------|---------|
| 8 | Instagram | Property address found |
| 7 | Instagram | Neighborhood found |
| 6 | Instagram/LinkedIn | Listing posts |
| 5 | Instagram/LinkedIn | Sold/success posts |
| 4 | LinkedIn | Market update posts |
| 3 | Instagram | Follower count (1k+) |
| 2 | LinkedIn | Headline specialty |
| 1 | Company | Compass/KW/Sotheby's |

### Recency Bonus (Added to Base)

| Days Since Post | Bonus |
|-----------------|-------|
| 0-3 days | +2.0 (very fresh) |
| 4-7 days | +1.5 (fresh) |
| 8-14 days | +1.0 (recent) |
| 15-30 days | +0.5 (somewhat recent) |
| 31+ days | +0 (no bonus) |

## AI Hook Generation (Hot Leads)

For hot leads (90+ ICP score), we generate personalized AI hooks instead of using templates.

### Workflow

```bash
# Step 1: Extract lead contexts for AI review
node enrichment/ai-hooks-generator.js \
  --input data/3operational/{batch}/segment-hot.csv \
  --output data/3operational/{batch}/hot-hooks.json

# Step 2: Claude Code reviews each lead and writes personalized hooks
# (Manual step - AI generates hooks based on lead context)

# Step 3: Apply hooks back to CSV
node enrichment/ai-hooks-generator.js \
  --apply data/3operational/{batch}/hot-hooks-completed.json \
  --to data/3operational/{batch}/enriched-full.csv
```

### What Claude Code Sees Per Lead

For each lead, Claude Code receives:
- Name, company, job title
- ICP score and tier
- Transaction urgency level
- LinkedIn headline and recent topic
- Instagram addresses, neighborhoods, listing/sold counts
- Current template hook

### AI Hook Guidelines

AI-generated hooks should be:
- **Specific** - Reference actual addresses, achievements, or activity
- **Direct** - No passive "curious about" language
- **Informative** - Surface a pain point or insight
- **Action-oriented** - Imply the value prop (5 minutes vs 4 hours)

### Example AI Hooks

| Lead | AI Hook |
|------|---------|
| Kevin Cruz ($1B+ sold) | "$1B+ sold and counting. At that volume, every hour spent on disclosures is a listing you're not taking. We cut that time to 5 minutes." |
| Joe Polyak (Probate specialist) | "Probate and trust sales at 6077 Skyline come with extra disclosure complexity. That's exactly what we built Discloser for." |
| Grazia Bennett (Top 10% TAN) | "Top 10% TAN member listing in Cole Valley - your buyers expect the same precision in disclosures that you bring to marketing. We make that easy." |

### When to Use AI Hooks

| Segment | Hook Type | Reason |
|---------|-----------|--------|
| **Hot (90+)** | AI-generated | Highest priority, worth the effort |
| **High (70-89)** | Template | Good volume, templates sufficient |
| **Medium/Low** | Template | Scale matters more than personalization |

## Instantly Integration

After enrichment, upload segments to Instantly:

1. Hot leads (AI hooks) → Immediate outreach, highest personalization
2. High-ICP leads → Priority campaign (more touchpoints)
3. Active listers → Listing-focused messaging
4. Recent closers → Success-focused messaging

Use `best_hook` column for {{personalization}} variable.

## Troubleshooting

### "APIFY_API_KEY not found"
```bash
cat GTM/.env
# Should show: APIFY_API_KEY=apify_api_xxxxx
```

### Low enrichment rate
- Check LinkedIn URLs are valid (not expired/private)
- Check IG handles are usernames, not post URLs
- Instagram private accounts won't return data

### Missing columns error
Ensure Clay export has required columns. Column names are case-sensitive.
