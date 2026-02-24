"""
Google Search Console ingestion.

Pulls search analytics (queries, pages, devices) and lands as CSV
in the landing zone.

Requires: pip install google-auth google-api-python-client
Env vars: GSC_CREDENTIALS_PATH, GSC_SITE_URL
"""

import csv
import logging
from datetime import datetime, timedelta
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

from .config import (
    GSC_CREDENTIALS_PATH, GSC_SITE_URL, GSC_LOOKBACK_DAYS, LANDING_DIR,
)

logger = logging.getLogger(__name__)

LANDING_PATH = LANDING_DIR / "google_search_console"

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

# dimensions we request per row
DIMENSIONS = ["date", "query", "page", "device", "country"]

ROW_LIMIT = 25_000  # GSC API max per request


def _build_service():
    credentials = service_account.Credentials.from_service_account_file(
        GSC_CREDENTIALS_PATH, scopes=SCOPES,
    )
    return build("searchconsole", "v1", credentials=credentials)


def _date_range():
    end = datetime.utcnow().date() - timedelta(days=3)  # GSC data lags ~3 days
    start = end - timedelta(days=GSC_LOOKBACK_DAYS)
    return str(start), str(end)


def _fetch_page(service, start_date: str, end_date: str, start_row: int = 0):
    """Fetch a single page of search analytics data."""
    body = {
        "startDate": start_date,
        "endDate": end_date,
        "dimensions": DIMENSIONS,
        "rowLimit": ROW_LIMIT,
        "startRow": start_row,
        "dataState": "final",
    }
    return service.searchanalytics().query(
        siteUrl=GSC_SITE_URL, body=body,
    ).execute()


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


def ingest_search_analytics():
    """
    Pull all search analytics data, paginating through the full result set.
    GSC returns max 25k rows per request, so we paginate via startRow.
    """
    service = _build_service()
    start_date, end_date = _date_range()

    all_rows = []
    start_row = 0

    while True:
        response = _fetch_page(service, start_date, end_date, start_row)
        api_rows = response.get("rows", [])

        if not api_rows:
            break

        for row in api_rows:
            keys = row.get("keys", [])
            record = {
                "date": keys[0] if len(keys) > 0 else "",
                "query": keys[1] if len(keys) > 1 else "",
                "page": keys[2] if len(keys) > 2 else "",
                "device": keys[3] if len(keys) > 3 else "",
                "country": keys[4] if len(keys) > 4 else "",
                "clicks": row.get("clicks", 0),
                "impressions": row.get("impressions", 0),
                "ctr": row.get("ctr", 0.0),
                "position": row.get("position", 0.0),
            }
            all_rows.append(record)

        if len(api_rows) < ROW_LIMIT:
            break

        start_row += ROW_LIMIT

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    _write_csv(all_rows, f"search_analytics_{ts}.csv")
    return all_rows


def run():
    """Full GSC ingestion."""
    LANDING_PATH.mkdir(parents=True, exist_ok=True)
    logger.info(f"Ingesting Google Search Console (lookback={GSC_LOOKBACK_DAYS}d)")

    ingest_search_analytics()

    logger.info("GSC ingestion complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
