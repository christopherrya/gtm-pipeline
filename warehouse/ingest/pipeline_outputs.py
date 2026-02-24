"""
Local pipeline outputs ingestion.

Reads the existing enrichment pipeline CSVs and orchestrator JSON artifacts
and copies them into the landing zone for dbt to pick up.

No external API calls — just reads from the local filesystem.
"""

from __future__ import annotations

import csv
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

from .config import PIPELINE_DATA_DIR, LANDING_DIR

logger = logging.getLogger(__name__)

LANDING_PATH = LANDING_DIR / "pipeline_outputs"


def _find_latest_csv(directory: Path, pattern: str = "*.csv") -> Path | None:
    """Find the most recently modified CSV matching a pattern."""
    candidates = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def _copy_csv(src: Path, dest_name: str):
    """Copy a CSV into the landing zone with a timestamp suffix."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    dest = LANDING_PATH / f"{dest_name}_{ts}.csv"
    shutil.copy2(src, dest)
    logger.info(f"Copied {src} → {dest}")


def _json_to_csv(json_path: Path, dest_name: str):
    """Convert a JSON file (array of objects) to CSV in the landing zone."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    dest = LANDING_PATH / f"{dest_name}_{ts}.csv"

    with open(json_path) as f:
        data = json.load(f)

    if not data:
        logger.warning(f"Empty JSON: {json_path}")
        return

    # handle both array-of-objects and single-object
    records = data if isinstance(data, list) else [data]

    fieldnames = list(dict.fromkeys(k for r in records for k in r.keys()))
    with open(dest, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            # flatten nested dicts to JSON strings
            flat = {}
            for k, v in record.items():
                flat[k] = json.dumps(v) if isinstance(v, (dict, list)) else v
            writer.writerow(flat)

    logger.info(f"Converted {json_path} → {dest} ({len(records)} rows)")


def ingest_enriched_leads():
    """Find and copy the latest enriched leads CSV."""
    # enrichment pipeline outputs to data/ directory
    for search_dir in [PIPELINE_DATA_DIR, PIPELINE_DATA_DIR / "enrichment"]:
        if not search_dir.exists():
            continue
        csv_file = _find_latest_csv(search_dir, "*enriched*.csv")
        if not csv_file:
            csv_file = _find_latest_csv(search_dir, "*leads*.csv")
        if csv_file:
            _copy_csv(csv_file, "enriched_leads")
            return
    logger.warning("No enriched leads CSV found")


def ingest_orchestrator_runs():
    """
    Read orchestrator run reports from data/orchestrator/runs/.
    Each run has a directory with node-level JSON reports.
    """
    runs_dir = PIPELINE_DATA_DIR / "orchestrator" / "runs"
    if not runs_dir.exists():
        logger.warning(f"Orchestrator runs dir not found: {runs_dir}")
        return

    all_rows = []
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        run_id = run_dir.name
        for report in run_dir.glob("*.json"):
            try:
                with open(report) as f:
                    data = json.load(f)
                data["run_id"] = run_id
                data["node_report_file"] = report.name
                all_rows.append(data)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Skipping {report}: {e}")

    if all_rows:
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        dest = LANDING_PATH / f"orchestrator_runs_{ts}.csv"
        fieldnames = list(dict.fromkeys(k for r in all_rows for k in r.keys()))
        with open(dest, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in all_rows:
                flat = {}
                for k, v in row.items():
                    flat[k] = json.dumps(v) if isinstance(v, (dict, list)) else v
                writer.writerow(flat)
        logger.info(f"Wrote {len(all_rows)} orchestrator run records → {dest}")
    else:
        logger.warning("No orchestrator run data found")


def ingest_listings():
    """Read brokerage listings JSON snapshots."""
    listings_dir = PIPELINE_DATA_DIR / "2listings"
    if not listings_dir.exists():
        logger.warning(f"Listings dir not found: {listings_dir}")
        return

    for json_file in listings_dir.glob("*.json"):
        _json_to_csv(json_file, f"listings_{json_file.stem}")


def ingest_crm_state():
    """Copy CRM contacts mirror and event log."""
    state_dir = PIPELINE_DATA_DIR / "orchestrator" / "state"
    if not state_dir.exists():
        logger.warning(f"Orchestrator state dir not found: {state_dir}")
        return

    for state_file in ["crm_contacts.json", "event_log.json", "instantly_leads.json"]:
        path = state_dir / state_file
        if path.exists():
            _json_to_csv(path, state_file.replace(".json", ""))


def run():
    """Full pipeline outputs ingestion."""
    LANDING_PATH.mkdir(parents=True, exist_ok=True)
    logger.info("Ingesting local pipeline outputs")

    ingest_enriched_leads()
    ingest_orchestrator_runs()
    ingest_listings()
    ingest_crm_state()

    logger.info("Pipeline outputs ingestion complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
