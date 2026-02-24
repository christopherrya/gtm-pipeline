"""
Master ingestion entrypoint. Runs all configured sources.

Usage:
    python -m warehouse.ingest.run_all                  # all sources
    python -m warehouse.ingest.run_all facebook_ads     # single source
    python -m warehouse.ingest.run_all gsc instantly    # multiple sources
"""

import argparse
import logging
import sys

from . import facebook_ads, google_search_console, instantly, pipeline_outputs

logger = logging.getLogger(__name__)

SOURCES = {
    "facebook_ads": facebook_ads.run,
    "gsc": google_search_console.run,
    "instantly": instantly.run,
    "pipeline_outputs": pipeline_outputs.run,
}


def main():
    parser = argparse.ArgumentParser(description="GTM Warehouse Ingestion")
    parser.add_argument(
        "sources",
        nargs="*",
        default=list(SOURCES.keys()),
        choices=list(SOURCES.keys()),
        help="Sources to ingest (default: all)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    failed = []
    for source in args.sources:
        logger.info(f"{'─' * 60}")
        logger.info(f"Ingesting: {source}")
        try:
            SOURCES[source]()
        except Exception:
            logger.exception(f"Failed: {source}")
            failed.append(source)

    if failed:
        logger.error(f"Failed sources: {', '.join(failed)}")
        sys.exit(1)

    logger.info("All ingestion complete")


if __name__ == "__main__":
    main()
