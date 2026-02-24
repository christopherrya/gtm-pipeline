"""
Facebook/Meta Ads ingestion.

Pulls campaign, ad set, and ad-level insights from the Marketing API
and lands them as CSV in the landing zone.

Requires: pip install facebook-business
Env vars: FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID
"""

import csv
import logging
from datetime import datetime, timedelta
from pathlib import Path

from facebook_business.api import FacebookAdsApi
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.campaign import Campaign
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.ad import Ad

from .config import (
    FB_APP_ID, FB_APP_SECRET, FB_ACCESS_TOKEN,
    FB_AD_ACCOUNT_ID, FB_LOOKBACK_DAYS, LANDING_DIR,
)

logger = logging.getLogger(__name__)

LANDING_PATH = LANDING_DIR / "facebook_ads"

# ── Insight fields we pull at each level ───────────────────────────────────────
INSIGHT_FIELDS = [
    "date_start",
    "date_stop",
    "impressions",
    "clicks",
    "spend",
    "cpm",
    "cpc",
    "ctr",
    "reach",
    "frequency",
    "actions",
    "cost_per_action_type",
    "conversions",
    "cost_per_conversion",
]

CAMPAIGN_FIELDS = [
    "id", "name", "status", "objective",
    "daily_budget", "lifetime_budget", "buying_type",
    "created_time", "updated_time",
]

AD_SET_FIELDS = [
    "id", "name", "campaign_id", "status",
    "daily_budget", "lifetime_budget",
    "bid_amount", "bid_strategy", "billing_event",
    "optimization_goal", "targeting",
    "start_time", "end_time",
    "created_time", "updated_time",
]

AD_FIELDS = [
    "id", "name", "adset_id", "campaign_id", "status",
    "creative", "created_time", "updated_time",
]


def _init_api():
    FacebookAdsApi.init(FB_APP_ID, FB_APP_SECRET, FB_ACCESS_TOKEN)
    return AdAccount(FB_AD_ACCOUNT_ID)


def _date_range():
    end = datetime.utcnow().date()
    start = end - timedelta(days=FB_LOOKBACK_DAYS)
    return str(start), str(end)


def _flatten_actions(actions_list):
    """Flatten the actions array into a dict keyed by action_type."""
    if not actions_list:
        return {}
    return {a["action_type"]: a["value"] for a in actions_list}


def _write_csv(rows: list[dict], filename: str):
    if not rows:
        logger.warning(f"No rows to write for {filename}")
        return
    path = LANDING_PATH / filename
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    logger.info(f"Wrote {len(rows)} rows → {path}")


def ingest_campaigns(account: AdAccount):
    """Pull campaign metadata."""
    campaigns = account.get_campaigns(fields=CAMPAIGN_FIELDS)
    rows = []
    for c in campaigns:
        row = {field: c.get(field, "") for field in CAMPAIGN_FIELDS}
        rows.append(row)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"campaigns_{ts}.csv")
    return rows


def ingest_ad_sets(account: AdAccount):
    """Pull ad set metadata."""
    ad_sets = account.get_ad_sets(fields=AD_SET_FIELDS)
    rows = []
    for a in ad_sets:
        row = {field: str(a.get(field, "")) for field in AD_SET_FIELDS}
        rows.append(row)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"ad_sets_{ts}.csv")
    return rows


def ingest_ads(account: AdAccount):
    """Pull ad metadata."""
    ads = account.get_ads(fields=AD_FIELDS)
    rows = []
    for a in ads:
        row = {field: str(a.get(field, "")) for field in AD_FIELDS}
        rows.append(row)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"ads_{ts}.csv")
    return rows


def ingest_insights(account: AdAccount, level: str = "ad"):
    """
    Pull insights at the specified level (campaign, adset, ad).
    Flattens the actions array into individual columns.
    """
    start_date, end_date = _date_range()

    params = {
        "level": level,
        "time_range": {"since": start_date, "until": end_date},
        "time_increment": 1,  # daily granularity
    }

    insights = account.get_insights(fields=INSIGHT_FIELDS, params=params)
    rows = []
    for i in insights:
        row = {}
        for field in INSIGHT_FIELDS:
            val = i.get(field, "")
            if field in ("actions", "cost_per_action_type"):
                flat = _flatten_actions(val)
                for action_type, action_val in flat.items():
                    row[f"{field}__{action_type}"] = action_val
            else:
                row[field] = val
        # include the entity id for join-back
        row[f"{level}_id"] = i.get(level + "_id", {}).get("id", "")
        rows.append(row)

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"insights_{level}_{ts}.csv")
    return rows


def run():
    """Full Facebook Ads ingestion."""
    LANDING_PATH.mkdir(parents=True, exist_ok=True)
    logger.info(f"Ingesting Facebook Ads (lookback={FB_LOOKBACK_DAYS}d)")

    account = _init_api()
    ingest_campaigns(account)
    ingest_ad_sets(account)
    ingest_ads(account)
    ingest_insights(account, level="campaign")
    ingest_insights(account, level="adset")
    ingest_insights(account, level="ad")

    logger.info("Facebook Ads ingestion complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
