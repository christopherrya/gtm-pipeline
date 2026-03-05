# GTM Pipeline Hub Runbook

## Overview

The hub is the central entry point for the GTM pipeline. It serves a static
dashboard page that links to all product apps and monitors their availability
with live health checks.

Current status:

- Hub server is implemented under `hub/`.
- Probes Ad Generator (port 3001), FlowDrip (port 3000), and Orchestrator (port 4312).
- No external dependencies — uses only Node.js built-ins.

## Entry Points

- Start hub server:
  - `npm run hub`
- Hub URL:
  - `http://localhost:4000`
- Status API:
  - `GET http://localhost:4000/api/status`

## Architecture

```
hub/
  server.js            # Node.js HTTP server (port 4000)
  public/
    index.html         # Semantic HTML dashboard
    styles.css         # Dark theme (matches FlowDrip)
    app.js             # Client-side status polling
```

The hub is a standalone vanilla HTTP server with no build step and no npm
dependencies beyond Node.js built-ins (`http`, `fs`, `path`). It serves static
files from `hub/public/` and exposes one API endpoint.

## How It Works

### Static File Serving

The server pattern mirrors `orchestrator/server.js` — same MIME map, same
`serveStatic()` helper, same path-traversal guard. Requests to `/` serve
`index.html`.

### Health Probes

`GET /api/status` runs concurrent HTTP probes against each product:

| Product       | Probe URL                            | Timeout |
|---------------|--------------------------------------|---------|
| Ad Generator  | `http://localhost:3001/`             | 2s      |
| FlowDrip      | `http://localhost:3000/`             | 2s      |
| Orchestrator  | `http://localhost:4312/api/state`    | 2s      |

Response format:

```json
{
  "products": [
    { "id": "ad-generator", "name": "Ad Generator", "port": 3001, "status": "online", "latencyMs": 42 },
    { "id": "flowdrip", "name": "FlowDrip", "port": 3000, "status": "offline", "latencyMs": -1 },
    { "id": "orchestrator", "name": "Orchestrator", "port": 4312, "status": "online", "latencyMs": 5 }
  ]
}
```

Status values: `online` (2xx/3xx response within timeout), `offline` (error or timeout).

### Client-Side Polling

`app.js` fetches `/api/status` every 15 seconds and updates the UI:

- Status dots turn green (online), red (offline), or gray (unknown)
- Topbar beacon summarizes overall state: all-online, partial, all-offline
- Card `data-status` attributes update for CSS-driven visual changes

## Configuration

| Variable        | Purpose                          | Default |
|-----------------|----------------------------------|---------|
| `GTM_HUB_PORT`  | Port the hub server listens on   | `4000`  |

No `.env` file or API keys needed for the hub itself.

## Operations

### Starting All Services

```bash
npm start   # boots everything — hub, orchestrator, FlowDrip, ad generator
```

This runs `start.sh`, which:
1. Installs missing dependencies (root, flowdrip, ad-generator) if needed
2. Starts all four services in parallel
3. Prints the URLs once everything is up
4. Ctrl+C cleanly shuts down all processes

To start individual services:

```bash
npm run hub                # Hub only         → http://localhost:4000
npm run orchestrator:start # Orchestrator only → http://localhost:4312
```

The hub works whether zero or all products are running. Status dots reflect
the current state.

### Verifying Health

```bash
# Quick check from terminal
curl -s http://localhost:4000/api/status | python3 -m json.tool
```

### Adding a New Product

To add a fourth product to the hub:

1. **`hub/server.js`** — Add an entry to the `PRODUCTS` array:
   ```js
   { id: 'new-product', name: 'New Product', port: XXXX, path: '/' }
   ```

2. **`hub/public/index.html`** — Add a new `<article class="product-card">` block.
   Copy an existing card and update:
   - `data-product`, `data-port`, `data-accent` attributes
   - Icon SVG, title, description, metadata, link href

3. **`hub/public/app.js`** — Add an entry to the `PRODUCTS` array:
   ```js
   { id: 'new-product', name: 'New Product', port: XXXX }
   ```

### LLM Interface

The HTML is designed for machine readability:

- Each product card is an `<article>` with `data-product`, `data-port`, `data-status`
- Metadata lives in `<dl>` elements (semantic key-value pairs)
- The status summary has `data-online` and `data-total` attributes
- No framework abstractions — raw HTML that any LLM can parse directly

To read hub state programmatically, query `GET /api/status` for structured JSON.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Hub page loads but all dots gray | Products not started yet | Start the products; dots update within 15s |
| Hub page loads but a dot stays red | Product crashed or wrong port | Check if the product is actually running on its expected port |
| `EADDRINUSE` on startup | Port 4000 already in use | Kill the existing process or set `GTM_HUB_PORT=4001` |
| Status dot shows online but link fails | Product is responding to health check but serving errors | Open the product URL directly to debug |
