"""
Ingestion configuration. Reads from environment variables with sensible defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────────────
WAREHOUSE_DIR = Path(__file__).resolve().parent.parent
LANDING_DIR = WAREHOUSE_DIR / "data" / "landing"

# ── Facebook Ads ───────────────────────────────────────────────────────────────
FB_APP_ID = os.getenv("FB_APP_ID", "")
FB_APP_SECRET = os.getenv("FB_APP_SECRET", "")
FB_ACCESS_TOKEN = os.getenv("FB_ACCESS_TOKEN", "")
FB_AD_ACCOUNT_ID = os.getenv("FB_AD_ACCOUNT_ID", "")  # format: act_XXXXXXXXX
FB_LOOKBACK_DAYS = int(os.getenv("FB_LOOKBACK_DAYS", "30"))

# ── Google Search Console ──────────────────────────────────────────────────────
GSC_CREDENTIALS_PATH = os.getenv("GSC_CREDENTIALS_PATH", "")  # service account JSON
GSC_SITE_URL = os.getenv("GSC_SITE_URL", "")  # e.g. https://example.com or sc-domain:example.com
GSC_LOOKBACK_DAYS = int(os.getenv("GSC_LOOKBACK_DAYS", "30"))

# ── Instantly ──────────────────────────────────────────────────────────────────
INSTANTLY_API_KEY = os.getenv("INSTANTLY_API_KEY", "")
INSTANTLY_LOOKBACK_DAYS = int(os.getenv("INSTANTLY_LOOKBACK_DAYS", "30"))

# ── Pipeline Outputs (local) ──────────────────────────────────────────────────
PIPELINE_DATA_DIR = Path(os.getenv(
    "PIPELINE_DATA_DIR",
    str(WAREHOUSE_DIR.parent / "data")
))
