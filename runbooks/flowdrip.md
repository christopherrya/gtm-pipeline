# FlowDrip Runbook

## Overview

FlowDrip is a visual email drip campaign builder. Users design campaigns as
directed graphs (DAGs) on a node canvas, then push them directly to
[Instantly.ai](https://instantly.ai) via its v2 API.

Current status:

- App is implemented under `flowdrip/`.
- Instantly API v2 integration is complete (create, update, activate, pause, delete campaigns + subsequences).
- Multi-campaign support — create, switch, duplicate, and delete campaigns from the sidebar.
- All campaigns persist in `localStorage` — survives page refresh, no database needed.
- Push to Instantly is password-protected.
- JSON export available for sharing or backup.

## Entry Points

- Start dev server:
  - `cd flowdrip && npm run dev -- -p 6060`
- Production build:
  - `cd flowdrip && npm run build && npm start`
- App URL:
  - `http://localhost:6060` (dev) or `http://localhost:3000` (production default)

## Architecture

```
flowdrip/
  app/
    page.tsx                              # Main page — ReactFlowProvider wrapper
    layout.tsx                            # Root layout — dark mode, Geist fonts, Toaster
    globals.css                           # Tailwind v4 + React Flow + custom styles
    api/instantly/
      campaigns/
        route.ts                          # GET list, POST create
        [id]/
          route.ts                        # PATCH update, DELETE
          activate/route.ts               # POST activate
          pause/route.ts                  # POST pause
      subsequences/
        route.ts                          # POST create subsequence
  components/
    TopBar.tsx                            # Campaign name, Save/Clear/Push buttons, Settings, password gate
    Sidebar.tsx                           # Campaign list (create/switch/duplicate/delete) + draggable node palette
    FlowCanvas.tsx                        # React Flow canvas with drag-drop, MiniMap, Controls
    ConfigPanel.tsx                       # Right panel — node-specific form fields
    InstantlySettingsDialog.tsx           # API key + campaign schedule modal
    VariantEditor.tsx                     # A/B email variant editor (inside ConfigPanel)
    nodes/
      TriggerNode.tsx                     # Green — entry point, one source handle
      EmailNode.tsx                       # Blue — subject preview, variant badge
      DelayNode.tsx                       # Amber — wait duration display
      ConditionNode.tsx                   # Purple — yes/no branching handles
      EndNode.tsx                         # Red — terminal node, target handle only
  lib/
    nodeTypes.ts                          # React Flow node type registry
    validation.ts                         # validateCampaign() + validateForInstantly()
    types/instantly.ts                    # All TypeScript interfaces for Instantly API
    instantly/
      transform.ts                       # DAG-to-linear transformation engine
      proxy.ts                           # Server-side API proxy helper
      client.ts                          # Client-side fetch wrappers
  store/
    campaignStore.ts                      # Zustand store — multi-campaign, localStorage persistence, Instantly state
```

## Tech Stack

| Dependency       | Version | Purpose                          |
|------------------|---------|----------------------------------|
| Next.js          | 16.x    | App Router framework             |
| React            | 19.x    | UI runtime                       |
| @xyflow/react    | 12.x    | Visual node canvas (React Flow)  |
| Zustand          | 5.x     | Client-side state management     |
| Tailwind CSS     | 4.x     | Utility-first styling            |
| radix-ui         | 1.x     | Accessible UI primitives         |
| shadcn/ui        | —       | Pre-built component library      |
| sonner           | 2.x     | Toast notifications              |
| lucide-react     | 0.575+  | Icon set                         |
| date-fns         | 4.x     | Date utilities                   |

## Node Types

| Type      | Color  | Handles        | Data Fields                                              |
|-----------|--------|----------------|----------------------------------------------------------|
| Trigger   | Green  | 1 source       | `triggerType`                                            |
| Email     | Blue   | 1 target, 1 src| `subject`, `previewText`, `body`, `fromName`, `fromEmail`, `variants[]` |
| Delay     | Amber  | 1 target, 1 src| `duration`, `unit` (minutes/hours/days/weeks)            |
| Condition | Purple | 1 target, 2 src| `conditionType` (opened/clicked/bounced), handles: `yes` + `no` |
| End       | Red    | 1 target       | —                                                        |

Condition nodes produce two labeled edges: **Yes** (green, `sourceHandle=yes`) and **No** (red, `sourceHandle=no`). The store's `onConnect` automatically applies the correct edge labels and colors.

## Instantly API Integration

### How It Works

FlowDrip campaigns are visual DAGs. Instantly campaigns are **linear sequences** with separate **subsequences** for branching. The transform engine bridges the gap.

### Transformation Algorithm (`lib/instantly/transform.ts`)

`transformGraphToInstantly(nodes, edges, campaignName, schedule)` returns `{ campaign, subsequences[], warnings[] }`.

Walk the graph from the Trigger node:

1. **Trigger** — skip, advance to next connected node.
2. **Email** — emit an `InstantlyStep` with accumulated delay. If node has `variants[]`, include them as A/B variants; otherwise use `subject`/`body` as a single variant.
3. **Delay** — accumulate delay. Convert to days:
   - Minutes: `ceil(minutes / 1440)`, minimum 1 day (warns if < 1440 min).
   - Hours: `ceil(hours / 24)`, minimum 1 day (warns if < 24 hrs).
   - Days: pass-through (minimum 1).
   - Weeks: multiply by 7.
4. **Condition** — fork:
   - **Yes branch** — recursively walk, package as an `ExtractedBranch`. This becomes an Instantly subsequence with `conditions: { email_opened: true }` (or clicked/bounced). Accumulated delay becomes `pre_delay`.
   - **No branch** — continues as the main path.
5. **End** — stop walking. Cycle detection prevents infinite loops.

### API Proxy Pattern

All Instantly API calls are proxied through Next.js API routes to keep the API key server-side.

```
Browser → /api/instantly/campaigns → proxyToInstantly() → https://api.instantly.ai/api/v2/campaigns
```

The proxy reads the API key from (in priority order):
1. `x-instantly-key` request header (per-session override from Settings dialog)
2. `INSTANTLY_API_KEY` environment variable (server `.env.local`)

### API Routes

| Route                                    | Methods      | Instantly Endpoint                |
|------------------------------------------|--------------|-----------------------------------|
| `/api/instantly/campaigns`               | GET, POST    | `/api/v2/campaigns`               |
| `/api/instantly/campaigns/[id]`          | PATCH, DELETE| `/api/v2/campaigns/:id`           |
| `/api/instantly/campaigns/[id]/activate` | POST         | `/api/v2/campaigns/:id/activate`  |
| `/api/instantly/campaigns/[id]/pause`    | POST         | `/api/v2/campaigns/:id/pause`     |
| `/api/instantly/subsequences`            | POST         | `/api/v2/subsequences`            |

### Client-Side Functions (`lib/instantly/client.ts`)

| Function             | HTTP      | Path                          |
|----------------------|-----------|-------------------------------|
| `createCampaign()`   | POST      | `/api/instantly/campaigns`    |
| `listCampaigns()`    | GET       | `/api/instantly/campaigns`    |
| `activateCampaign()` | POST      | `/api/instantly/campaigns/:id/activate` |
| `pauseCampaign()`    | POST      | `/api/instantly/campaigns/:id/pause`    |
| `deleteCampaign()`   | DELETE    | `/api/instantly/campaigns/:id`          |
| `createSubsequence()`| POST      | `/api/instantly/subsequences` |

All accept an optional `apiKeyOverride` string that gets sent as the `x-instantly-key` header.

### Instantly API Payload Format

Campaign creation (`POST /api/v2/campaigns`):

```json
{
  "name": "My Campaign",
  "campaign_schedule": {
    "start_date": "2026-02-23",
    "end_date": "2026-03-23",
    "schedules": [{
      "name": "Default Schedule",
      "timing": { "from": "09:00", "to": "17:00" },
      "days": { "monday": true, "tuesday": true, "wednesday": true, "thursday": true, "friday": true },
      "timezone": "America/New_York"
    }]
  },
  "sequences": [{
    "steps": [
      { "type": "email", "delay": 0, "variants": [{ "subject": "Hi {{firstName}}", "body": "<p>Hello</p>" }] },
      { "type": "email", "delay": 3, "variants": [{ "subject": "Follow up", "body": "<p>Just checking in</p>" }] }
    ]
  }]
}
```

Subsequence creation (`POST /api/v2/subsequences`):

```json
{
  "parent_campaign": "campaign-uuid",
  "name": "Email opened - Yes",
  "conditions": { "email_opened": true },
  "sequences": [{ "steps": [{ "type": "email", "delay": 0, "variants": [{ "subject": "Thanks!", "body": "..." }] }] }],
  "pre_delay": 1
}
```

### Push Flow (TopBar.tsx)

1. Click **Push to Instantly** button.
2. `validateCampaign()` — checks graph structure (trigger exists, nodes connected, etc.)
3. `validateForInstantly()` — checks Instantly-specific requirements (email subject/body, delay warnings).
4. **Password dialog** appears — user must enter the push password to proceed.
5. On correct password, `transformGraphToInstantly()` produces `{ campaign, subsequences[], warnings[] }`.
6. `createCampaign(campaign)` — returns `{ id }` from Instantly.
7. For each subsequence: `createSubsequence({ ...sub, parent_campaign: id })`.
8. Campaign ID is stored (persisted in localStorage). Button changes to **Update on Instantly**.
9. Toast success or error.

## State Management (`store/campaignStore.ts`)

Single Zustand store with multi-campaign support and `localStorage` persistence.

### Multi-Campaign State
- `campaigns: Campaign[]` — all saved campaigns
- `activeCampaignId: string | null` — which campaign is loaded on the canvas

Each `Campaign` contains: `id`, `name`, `nodes`, `edges`, `instantlyCampaignId`, `campaignSchedule`, `createdAt`, `updatedAt`.

### Canvas State (derived from active campaign)
- `nodes: Node[]` — all React Flow nodes
- `edges: Edge[]` — all connections
- `selectedNodeId: string | null` — currently selected node (drives ConfigPanel)
- `campaignName: string` — editable campaign title

### Instantly Integration State
- `instantlyApiKey: string` — persisted in `localStorage` separately
- `instantlyCampaignId: string | null` — set after first push (enables update mode)
- `instantlyStatus: "idle" | "pushing" | "success" | "error"` — push state
- `instantlyError: string | null` — last error message
- `campaignSchedule` — start/end dates, from/to times, timezone, active days

Default schedule: weekdays (Mon-Fri), 09:00-17:00, user's local timezone, start date = today.

### Persistence

All campaign data auto-saves to `localStorage` on every mutation. Three keys are used:

| localStorage Key | Contents |
|---|---|
| `flowdrip-campaigns` | JSON array of all `Campaign` objects |
| `flowdrip-active-campaign` | ID of the last active campaign |
| `flowdrip-instantly-key` | Instantly API key (persists across sessions) |

On page load, the store reads from `localStorage` and restores the last active campaign. If no campaigns exist (first visit), the app creates a default "Untitled Campaign".

### Campaign Actions

| Action | Behavior |
|---|---|
| `createCampaign(name?)` | Saves current campaign, creates a new blank one, switches to it |
| `switchCampaign(id)` | Saves current campaign, loads target campaign onto the canvas |
| `deleteCampaign(id)` | Removes campaign. If active, switches to the next one |
| `duplicateCampaign(id)` | Deep copies a campaign (without its Instantly push ID), switches to the copy |

## Validation (`lib/validation.ts`)

### `validateCampaign(nodes, edges)` — General Checks
- Campaign not empty
- Exactly one Trigger node
- All non-End nodes have outgoing connections
- Unreachable nodes detected (warning)
- End node present (warning if missing)
- Condition nodes have both Yes and No paths (warning)

### `validateForInstantly(nodes, edges)` — Instantly-Specific
- At least one Email node required
- All Email nodes must have non-empty `subject` and `body`
- Sub-day delays (minutes < 1440, hours < 24) trigger rounding warnings
- Condition Yes → End directly triggers empty subsequence warning

Both return `{ valid: boolean, errors: string[], warnings: string[] }`.

## Configuration

| Variable              | File         | Purpose                              | Default                            |
|-----------------------|--------------|--------------------------------------|------------------------------------|
| `INSTANTLY_API_KEY`   | `.env.local` | Instantly API v2 Bearer token        | `your_api_key_here` (placeholder)  |
| `INSTANTLY_BASE_URL`  | `.env.local` | Instantly API base URL               | `https://api.instantly.ai/api/v2`  |

Users can also set their API key per-session via the Settings dialog (gear icon in TopBar). This takes priority over the environment variable.

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  TopBar: [FlowDrip logo] [Campaign Name] [Clear][Save][⚙][Push]   │
├──────────┬────────────────────────────────────┬──────────────────────┤
│ Sidebar  │          FlowCanvas               │    ConfigPanel       │
│ 260px    │   React Flow canvas               │    320px             │
│          │   Background dots, MiniMap,        │    (visible when     │
│ Campaign │   Controls                        │    node selected)    │
│ list     │                                    │                      │
│ ──────── │   Drop nodes, connect edges,      │    Node-specific     │
│ Node     │   select/delete/move               │    form fields       │
│ palette  │                                    │                      │
├──────────┴────────────────────────────────────┴──────────────────────┤
```

## Operations

### Starting FlowDrip

```bash
cd flowdrip && npm run dev -- -p 6060
```

Or as part of the full GTM pipeline:

```bash
npm start   # from gtm-pipeline root — starts hub, orchestrator, flowdrip, ad generator
```

### Setting Up Instantly

1. Get your API key from [Instantly Dashboard](https://app.instantly.ai) → Settings → API Keys.
2. Either:
   - Add it to `flowdrip/.env.local` as `INSTANTLY_API_KEY=your_key`
   - Or enter it per-session in the Settings dialog (gear icon)
3. Click "Test" in the Settings dialog to verify the connection.

### Managing Campaigns

- **Create**: Click **+ New Campaign** at the bottom of the campaign list in the sidebar.
- **Switch**: Click any campaign name in the sidebar to load it onto the canvas. The previous campaign is auto-saved.
- **Rename**: Edit the campaign name in the TopBar input field (center). Changes persist immediately.
- **Duplicate**: Hover over a campaign in the sidebar, click the copy icon. Creates a deep copy without the Instantly push ID.
- **Delete**: Hover over a campaign, click the trash icon. Cannot delete the last remaining campaign.

All campaigns persist in `localStorage` — closing the browser and reopening preserves everything.

### Building a Campaign

1. Drag a **Trigger** node from the sidebar to the canvas.
2. Drag **Email** nodes and configure subject/body in the right panel.
3. Add **Delay** nodes between emails (set duration and unit).
4. Optionally add **Condition** nodes for branching (e.g., "Email opened").
5. Connect the **Yes** and **No** handles to different paths.
6. Add **End** nodes to terminate each path.
7. Add A/B variants via the Variant Editor below the email form.

### Pushing to Instantly

1. Click the **Push to Instantly** button (purple gradient, top right).
2. The system validates the campaign and shows warnings/errors as toasts.
3. A **password dialog** appears — enter the push password to authorize.
4. On success, the campaign appears in your Instantly dashboard.
5. After the first push, the button changes to **Update on Instantly**.
6. The push state (campaign ID) is persisted — survives page refresh.

### Saving/Loading JSON

- **Save**: Click **Save JSON** — downloads a `.json` file with full node/edge state.
- **Load**: Not yet implemented via UI. Can be restored programmatically by calling `setNodes()` and `setEdges()` from the Zustand store.

## A/B Testing (Variants)

Email nodes support A/B variant testing. The primary subject/body is Variant A.
Additional variants (B, C, etc.) are added via the **Variant Editor** in the
ConfigPanel.

On push to Instantly, all variants are included in the step's `variants[]` array.
Instantly handles the split testing and reporting.

Variants are stored on the node's `data.variants` as `FlowDripVariant[]`:

```ts
{ id: string; subject: string; body: string; }
```

## Adding a New Node Type

To add a new node type (e.g., "Webhook"):

1. **`components/nodes/WebhookNode.tsx`** — Create the visual component with appropriate Handles.
2. **`lib/nodeTypes.ts`** — Register it: `webhook: WebhookNode`.
3. **`components/Sidebar.tsx`** — Add a draggable card entry.
4. **`components/FlowCanvas.tsx`** — Add default data to `defaultNodeData`.
5. **`components/ConfigPanel.tsx`** — Add a form section for the new type.
6. **`lib/instantly/transform.ts`** — Add a `case` in the `walkPath` switch to handle it during transformation.
7. **`lib/validation.ts`** — Add any validation rules.

## Adding a New Instantly API Route

To proxy a new Instantly endpoint:

1. Create a route file under `app/api/instantly/` matching the path structure.
2. Import `proxyToInstantly` from `@/lib/instantly/proxy`.
3. Export handler functions (GET, POST, PATCH, DELETE) that call `proxyToInstantly(req, path, method)`.
4. For dynamic routes with `[id]`, destructure params as `{ params: Promise<{ id: string }> }` and `await` it (Next.js 16 requirement).
5. Add a client-side wrapper in `lib/instantly/client.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "API key required" error on push | No key configured | Add key to `.env.local` or Settings dialog |
| "Test Connection" fails | Invalid API key or network issue | Verify key at instantly.ai dashboard, check network |
| Sub-day delay warnings | Instantly only supports day-level delays | Use 1+ day delays, or accept the rounding |
| "Only one Trigger node" toast | Tried to drop a second trigger | Delete the existing trigger first |
| Push succeeds but no emails send | Campaign not activated in Instantly | Activate the campaign in the Instantly dashboard or call the activate endpoint |
| `.next/dev/lock` error on startup | Stale lock from crashed dev server | Delete `flowdrip/.next/dev/lock` and retry |
| Node not appearing on drop | Missing entry in `defaultNodeData` | Add defaults in `FlowCanvas.tsx` |
| ConfigPanel empty when node selected | Node type not handled in ConfigPanel | Add a conditional section for the type |
| Build fails with `unknown is not ReactNode` | JSX conditional returns `unknown` | Use ternary (`? ... : null`) instead of `&&` |

## Known Limitations

1. ~~Campaign state is client-side only — refreshing the page loses the campaign.~~ **Resolved** — campaigns now persist in `localStorage`.
2. ~~`instantlyCampaignId` is stored in memory — page refresh loses push state.~~ **Resolved** — push state persists per campaign in `localStorage`.
3. Sub-day delays (minutes, hours) are rounded up to 1 day minimum for Instantly.
4. No campaign import UI yet — JSON can only be loaded programmatically.
5. The transform engine walks the "No" branch as the main path and "Yes" branch as the subsequence. This matches the most common pattern (Yes = engaged → send targeted follow-up) but may need adjustment for other use cases.
6. No real-time sync with Instantly — changes made in the Instantly dashboard are not reflected back.
