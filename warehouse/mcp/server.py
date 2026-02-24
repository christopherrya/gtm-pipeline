"""
MCP Server for the GTM Warehouse.

Exposes DuckDB warehouse to Claude via the Model Context Protocol.
Provides tools for querying data, listing tables, describing schemas,
and reading the semantic layer.

Usage:
    python -m warehouse.mcp.server

Claude Code config (~/.claude/claude_desktop_config.json):
    {
        "mcpServers": {
            "gtm-warehouse": {
                "command": "python",
                "args": ["-m", "warehouse.mcp.server"],
                "cwd": "/path/to/gtm-pipeline/warehouse"
            }
        }
    }
"""

import json
import logging
from pathlib import Path

import duckdb
from mcp.server import Server
from mcp.server.stdio import run_server
from mcp.types import (
    TextContent,
    Tool,
    Resource,
    ResourceTemplate,
)

logger = logging.getLogger(__name__)

WAREHOUSE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = WAREHOUSE_DIR / "gtm.duckdb"
SEMANTIC_LAYER_PATH = WAREHOUSE_DIR / "mcp" / "semantic_layer.yml"

# ── DuckDB connection ──────────────────────────────────────────────────────────

def get_connection() -> duckdb.DuckDBPyConnection:
    """Get a read-only DuckDB connection."""
    return duckdb.connect(str(DB_PATH), read_only=True)


def execute_query(sql: str, limit: int = 500) -> dict:
    """Execute a SQL query and return results as a dict."""
    conn = get_connection()
    try:
        # safety: enforce row limit to prevent massive result sets
        if "limit" not in sql.lower():
            sql = f"{sql.rstrip().rstrip(';')} LIMIT {limit}"

        result = conn.execute(sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()

        return {
            "columns": columns,
            "rows": [dict(zip(columns, row)) for row in rows],
            "row_count": len(rows),
            "truncated": len(rows) >= limit,
        }
    finally:
        conn.close()


# ── MCP Server ─────────────────────────────────────────────────────────────────

app = Server("gtm-warehouse")


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="query_warehouse",
            description=(
                "Execute a SQL query against the GTM data warehouse (DuckDB). "
                "Use this to analyze Facebook Ads performance, Google Search Console "
                "SEO data, Instantly email campaign metrics, and enriched lead data. "
                "Returns up to 500 rows by default."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "The SQL query to execute. DuckDB SQL syntax.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max rows to return (default 500).",
                        "default": 500,
                    },
                },
                "required": ["sql"],
            },
        ),
        Tool(
            name="list_tables",
            description=(
                "List all tables and views in the warehouse, organized by schema/layer. "
                "Schemas: ingress, raw, staging, analytical, operational, reporting."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="describe_table",
            description=(
                "Get the column names, types, and descriptions for a specific table. "
                "Include the schema prefix, e.g. 'reporting.rpt_ad_performance_daily'."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "table_name": {
                        "type": "string",
                        "description": (
                            "Fully qualified table name (schema.table), "
                            "e.g. 'reporting.rpt_ad_performance_daily'"
                        ),
                    },
                },
                "required": ["table_name"],
            },
        ),
        Tool(
            name="get_semantic_layer",
            description=(
                "Read the semantic layer definition. This describes the business meaning "
                "of each table, column, metric, and relationship in the warehouse. "
                "Use this FIRST before writing queries to understand the data model."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="sample_data",
            description=(
                "Get a sample of rows from a table to understand the data shape. "
                "Returns 10 rows by default."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "table_name": {
                        "type": "string",
                        "description": "Fully qualified table name (schema.table)",
                    },
                    "sample_size": {
                        "type": "integer",
                        "description": "Number of sample rows (default 10)",
                        "default": 10,
                    },
                },
                "required": ["table_name"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        if name == "query_warehouse":
            result = execute_query(
                arguments["sql"],
                limit=arguments.get("limit", 500),
            )
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str),
            )]

        elif name == "list_tables":
            conn = get_connection()
            try:
                tables = conn.execute("""
                    SELECT table_schema, table_name, table_type
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY
                        CASE table_schema
                            WHEN 'ingress' THEN 1
                            WHEN 'raw' THEN 2
                            WHEN 'staging' THEN 3
                            WHEN 'analytical' THEN 4
                            WHEN 'operational' THEN 5
                            WHEN 'reporting' THEN 6
                            ELSE 7
                        END,
                        table_name
                """).fetchall()
            finally:
                conn.close()

            output = "# GTM Warehouse Tables\n\n"
            current_schema = None
            for schema, table, table_type in tables:
                if schema != current_schema:
                    output += f"\n## {schema}\n"
                    current_schema = schema
                output += f"  - {schema}.{table} ({table_type})\n"

            return [TextContent(type="text", text=output)]

        elif name == "describe_table":
            table_name = arguments["table_name"]
            conn = get_connection()
            try:
                # get columns
                cols = conn.execute(f"DESCRIBE {table_name}").fetchall()
            finally:
                conn.close()

            output = f"# {table_name}\n\n"
            output += "| Column | Type | Nullable |\n"
            output += "|--------|------|----------|\n"
            for col in cols:
                output += f"| {col[0]} | {col[1]} | {col[2]} |\n"

            return [TextContent(type="text", text=output)]

        elif name == "get_semantic_layer":
            if SEMANTIC_LAYER_PATH.exists():
                content = SEMANTIC_LAYER_PATH.read_text()
            else:
                content = "Semantic layer file not found. Run `dbt docs generate` and check warehouse/mcp/semantic_layer.yml"
            return [TextContent(type="text", text=content)]

        elif name == "sample_data":
            table_name = arguments["table_name"]
            sample_size = arguments.get("sample_size", 10)
            result = execute_query(
                f"SELECT * FROM {table_name} USING SAMPLE {sample_size}",
                limit=sample_size,
            )
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str),
            )]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


@app.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="warehouse://semantic-layer",
            name="Semantic Layer",
            description="Business definitions for all warehouse tables, columns, and metrics",
            mimeType="text/yaml",
        ),
    ]


@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "warehouse://semantic-layer":
        if SEMANTIC_LAYER_PATH.exists():
            return SEMANTIC_LAYER_PATH.read_text()
        return "Semantic layer not found."
    raise ValueError(f"Unknown resource: {uri}")


async def main():
    await run_server(app)


if __name__ == "__main__":
    import asyncio
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
