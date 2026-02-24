"""
Instantly email marketing analytics ingestion.

Pulls campaign analytics, lead status, and email events from
the Instantly API v2 and lands as CSV in the landing zone.

Requires: pip install requests
Env vars: INSTANTLY_API_KEY
API docs: https://developer.instantly.ai/
"""

from __future__ import annotations

import csv
import logging
from datetime import datetime, timedelta

import requests

from .config import INSTANTLY_API_KEY, INSTANTLY_LOOKBACK_DAYS, LANDING_DIR

logger = logging.getLogger(__name__)

LANDING_PATH = LANDING_DIR / "instantly"

BASE_URL = "https://api.instantly.ai/api/v2"


def _headers() -> dict:
    """Build auth headers at call time (not import time)."""
    return {
        "Authorization": f"Bearer {INSTANTLY_API_KEY}",
        "Content-Type": "application/json",
    }


def _get(endpoint: str, params: dict | None = None) -> dict:
    url = f"{BASE_URL}/{endpoint}"
    resp = requests.get(url, headers=_headers(), params=params or {}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _get_paginated(endpoint: str, params: dict | None = None) -> list[dict]:
    """Handle Instantly's cursor-based pagination."""
    params = params or {}
    all_items = []
    starting_after = None

    while True:
        if starting_after:
            params["starting_after"] = starting_after

        data = _get(endpoint, params)
        items = data if isinstance(data, list) else data.get("items", data.get("data", []))

        if not items:
            break

        all_items.extend(items)

        # check for next page cursor
        if isinstance(data, dict) and data.get("next_starting_after"):
            starting_after = data["next_starting_after"]
        else:
            break

    return all_items


def _write_csv(rows: list[dict], filename: str):
    if not rows:
        logger.warning(f"No rows to write for {filename}")
        return
    # collect all keys across all rows for union schema
    fieldnames = list(dict.fromkeys(k for row in rows for k in row.keys()))
    path = LANDING_PATH / filename
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    logger.info(f"Wrote {len(rows)} rows → {path}")


def ingest_campaigns():
    """Pull campaign metadata and summary stats."""
    campaigns = _get_paginated("campaigns", {"limit": 100})
    rows = []
    for c in campaigns:
        rows.append({
            "campaign_id": c.get("id", ""),
            "name": c.get("name", ""),
            "status": c.get("status", ""),
            "created_at": c.get("created_at", ""),
            "updated_at": c.get("updated_at", ""),
            "daily_limit": c.get("daily_limit", ""),
            "email_account_ids": str(c.get("email_accounts", [])),
        })

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"campaigns_{ts}.csv")
    return rows


def ingest_campaign_analytics():
    """Pull per-campaign analytics (sends, opens, clicks, replies, bounces)."""
    try:
        campaigns = _get_paginated("campaigns", {"limit": 100})
    except requests.HTTPError as e:
        logger.error(f"Failed to list campaigns for analytics: {e}")
        return []
    rows = []

    for c in campaigns:
        campaign_id = c.get("id", "")
        try:
            analytics = _get(f"campaigns/{campaign_id}/analytics")
        except requests.HTTPError as e:
            logger.warning(f"Failed analytics for campaign {campaign_id}: {e}")
            continue

        # analytics may be a list of daily stats or a summary object
        if isinstance(analytics, list):
            for day in analytics:
                rows.append({
                    "campaign_id": campaign_id,
                    "campaign_name": c.get("name", ""),
                    "date": day.get("date", ""),
                    "sent": day.get("sent", 0),
                    "opened": day.get("opened", 0),
                    "unique_opened": day.get("unique_opened", 0),
                    "clicked": day.get("clicked", 0),
                    "unique_clicked": day.get("unique_clicked", 0),
                    "replied": day.get("replied", 0),
                    "bounced": day.get("bounced", 0),
                    "unsubscribed": day.get("unsubscribed", 0),
                })
        else:
            rows.append({
                "campaign_id": campaign_id,
                "campaign_name": c.get("name", ""),
                "date": datetime.utcnow().strftime("%Y-%m-%d"),
                "sent": analytics.get("sent", 0),
                "opened": analytics.get("opened", 0),
                "unique_opened": analytics.get("unique_opened", 0),
                "clicked": analytics.get("clicked", 0),
                "unique_clicked": analytics.get("unique_clicked", 0),
                "replied": analytics.get("replied", 0),
                "bounced": analytics.get("bounced", 0),
                "unsubscribed": analytics.get("unsubscribed", 0),
            })

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"campaign_analytics_{ts}.csv")
    return rows


def ingest_leads():
    """Pull lead-level data with email event history."""
    leads = _get_paginated("leads", {"limit": 100})
    rows = []

    for lead in leads:
        rows.append({
            "lead_id": lead.get("id", ""),
            "email": lead.get("email", ""),
            "first_name": lead.get("first_name", ""),
            "last_name": lead.get("last_name", ""),
            "company_name": lead.get("company_name", ""),
            "campaign_id": lead.get("campaign_id", ""),
            "status": lead.get("status", ""),
            "lead_status": lead.get("lead_status", ""),
            "substatus": lead.get("substatus", ""),
            "interested": lead.get("interested", False),
            "created_at": lead.get("created_at", ""),
            "last_contacted_at": lead.get("last_contacted_at", ""),
            "email_opened": lead.get("email_opened", False),
            "email_clicked": lead.get("email_clicked", False),
            "email_replied": lead.get("email_replied", False),
            "email_bounced": lead.get("email_bounced", False),
        })

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(rows, f"leads_{ts}.csv")
    return rows


def run():
    """Full Instantly ingestion."""
    LANDING_PATH.mkdir(parents=True, exist_ok=True)
    logger.info(f"Ingesting Instantly (lookback={INSTANTLY_LOOKBACK_DAYS}d)")

    ingest_campaigns()
    ingest_campaign_analytics()
    ingest_leads()

    logger.info("Instantly ingestion complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
