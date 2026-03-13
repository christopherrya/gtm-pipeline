# ICP Scoring System (Post-Clay)

## Overview

This document defines the Ideal Customer Profile (ICP) scoring system used after Clay exports are enriched with LinkedIn and Instagram data. The goal is to identify high-intent leads who are most likely to need disclosure services right now.

**Max Score: 110 points**

---

## Scoring Components

### 1. Clay Baseline (50 points)

Every lead starts with 50 points from Clay, which confirms:
- Valid work email exists
- LinkedIn URL found
- Instagram handle found
- Company and job title present

| Signal | Points |
|--------|--------|
| Clay baseline | **50** |

---

### 2. LinkedIn Activity Signals (Max +15 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| LinkedIn enriched (posts found) | +5 | `linkedin_enriched === 'Yes'` |
| LinkedIn 3+ posts | +5 | `linkedin_posts_count >= 3` |
| LinkedIn specialty headline | +5 | Headline contains keywords below |

**Specialty headline keywords:**
- `luxury` → High-value transactions
- `team` / `lead` → Manages multiple agents
- `top` / `#1` / `million` → High producer
- `broker` → Decision maker

---

### 3. Instagram Activity Signals (Max +15 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| Instagram enriched (posts found) | +5 | `ig_enriched === 'Yes'` |
| IG 2+ listing posts | +5 | `ig_listing_posts_count >= 2` |
| IG 1,000+ followers | +3 | `ig_followers >= 1000` |
| IG property address extractable | +2 | `ig_recent_addresses` is not empty |

---

### 4. Transaction Urgency Signals (Max +20 points)

These signals indicate the agent is currently mid-transaction and needs disclosures NOW.

| Signal | Points | Detection |
|--------|--------|-----------|
| Just listed within 7 days | +10 | Listing post + recency ≤ 7 days |
| Just sold within 7 days | +5 | Sold post + recency ≤ 7 days |
| Multiple transactions (2+) | +5 | 2+ listing or sold posts |

**Note:** This category caps at +20 total, signals don't fully stack.

---

### 5. Recency Bonus (Max +10 points, Min -10 penalty)

| Most Recent Post | Points | Interpretation |
|------------------|--------|----------------|
| Within 3 days | **+10** | Very active right now |
| Within 7 days | **+7** | Active this week |
| Within 14 days | **+5** | Recently active |
| Within 30 days | **+2** | Somewhat active |
| 30-90 days ago | **0** | Baseline |
| 90+ days ago | **-10** | Penalty: likely disengaged |

**Recency is calculated from the most recent post across LinkedIn OR Instagram (whichever is newer).**

---

## Scoring Formula

```
ICP Score = Clay Baseline (50)
          + LinkedIn Activity (0-15)
          + Instagram Activity (0-15)
          + Transaction Urgency (0-20)
          + Recency Bonus (-10 to +10)
```

**Range: 40 to 110 points**

---

## Tier Thresholds

| Tier | Score | Description | Action |
|------|-------|-------------|--------|
| **Hot** | 90+ | In-contract + active + recent | Priority outreach, same-day |
| **High** | 70-89 | Active on socials, recent posts | Outreach within 48 hours |
| **Medium** | 55-69 | Has presence, moderate activity | Standard campaign |
| **Low** | <55 | Minimal activity or stale | Nurture sequence only |

---

## Example Scoring

### Lead A: Sarah Chen — Score: 105 (HOT)

| Category | Signal | Points |
|----------|--------|--------|
| Clay Baseline | — | 50 |
| LinkedIn | Enriched | +5 |
| LinkedIn | 4 posts | +5 |
| LinkedIn | "Team Lead" in headline | +5 |
| Instagram | Enriched | +5 |
| Instagram | 3 listing posts | +5 |
| Instagram | 2,400 followers | +3 |
| Instagram | Address found | +2 |
| Transaction | Just listed within 7 days | +10 |
| Transaction | Multiple transactions | +5 |
| Recency | Posted 2 days ago | +10 |
| **Total** | | **105** |

**Action:** Immediate outreach — she has a deal closing and needs disclosures.

---

### Lead B: Mike Torres — Score: 68 (MEDIUM)

| Category | Signal | Points |
|----------|--------|--------|
| Clay Baseline | — | 50 |
| LinkedIn | Enriched | +5 |
| LinkedIn | 2 posts (not 3+) | +0 |
| Instagram | Enriched | +5 |
| Instagram | 1 listing post (not 2+) | +0 |
| Instagram | 800 followers (not 1k+) | +0 |
| Transaction | No signals | +0 |
| Recency | Posted 12 days ago | +5 |
| **Total** | | **65** |

**Action:** Standard campaign, no urgency.

---

### Lead C: Jane Wilson — Score: 40 (LOW)

| Category | Signal | Points |
|----------|--------|--------|
| Clay Baseline | — | 50 |
| LinkedIn | Private profile, no posts | +0 |
| Instagram | No posts found | +0 |
| Transaction | No signals | +0 |
| Recency | Last post 120 days ago | -10 |
| **Total** | | **40** |

**Action:** Nurture only, low probability of engagement.

---

## Output Columns

| Column | Description |
|--------|-------------|
| `icp_score` | Final calculated score (40-110) |
| `icp_tier` | Hot / High / Medium / Low |
| `icp_breakdown` | Itemized point breakdown |
| `transaction_urgency` | High / Medium / Low / None |
| `days_since_post` | Recency metric used |

---

## Point Allocation Summary

| Category | Max Points | % of Max |
|----------|------------|----------|
| Clay Baseline | 50 | 45% |
| LinkedIn Activity | 15 | 14% |
| Instagram Activity | 15 | 14% |
| Transaction Urgency | 20 | 18% |
| Recency Bonus | 10 | 9% |
| **Total** | **110** | 100% |

---

*Last updated: 2026-02-05*
