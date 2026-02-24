.PHONY: setup ingest ingest-fb ingest-gsc ingest-instantly ingest-pipeline dbt-deps dbt-run dbt-test dbt-docs mcp-serve full-refresh

# ── Setup ──────────────────────────────────────────────────────────────────
setup:
	pip install -r requirements.txt
	$(MAKE) dbt-deps

# ── Ingestion ──────────────────────────────────────────────────────────────
ingest:
	python -m warehouse.ingest.run_all

ingest-fb:
	python -m warehouse.ingest.run_all facebook_ads

ingest-gsc:
	python -m warehouse.ingest.run_all gsc

ingest-instantly:
	python -m warehouse.ingest.run_all instantly

ingest-pipeline:
	python -m warehouse.ingest.run_all pipeline_outputs

# ── dbt ────────────────────────────────────────────────────────────────────
dbt-deps:
	dbt deps --profiles-dir .

dbt-run:
	dbt run --profiles-dir .

dbt-run-full:
	dbt run --profiles-dir . --full-refresh

dbt-test:
	dbt test --profiles-dir .

dbt-docs:
	dbt docs generate --profiles-dir .
	dbt docs serve --profiles-dir . --port 8081

# Run a specific layer
dbt-run-staging:
	dbt run --profiles-dir . --select staging.*

dbt-run-analytical:
	dbt run --profiles-dir . --select analytical.*

dbt-run-operational:
	dbt run --profiles-dir . --select operational.*

dbt-run-reporting:
	dbt run --profiles-dir . --select reporting.*

# ── MCP Server ─────────────────────────────────────────────────────────────
mcp-serve:
	python -m warehouse.mcp.server

# ── Full Pipeline ──────────────────────────────────────────────────────────
full-refresh: ingest dbt-run-full dbt-test
	@echo "Full refresh complete."
