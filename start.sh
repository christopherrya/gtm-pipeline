#!/usr/bin/env bash
# ──────────────────────────────────────────────
# GTM Pipeline — Start all services
# Usage: ./start.sh  (or: npm start)
# ──────────────────────────────────────────────

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${GREEN}GTM Pipeline${RESET} — starting all services"
echo ""

# ── Install deps if missing ──

if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing root dependencies...${RESET}"
  npm install --silent
fi

if [ ! -d "flowdrip/node_modules" ]; then
  echo -e "${YELLOW}Installing FlowDrip dependencies...${RESET}"
  (cd flowdrip && npm install --silent)
fi

if [ ! -d "ad-generator/node_modules" ]; then
  echo -e "${YELLOW}Installing Ad Generator dependencies...${RESET}"
  (cd ad-generator && npm install --silent)
fi

# ── Cleanup on exit ──

PIDS=()

cleanup() {
  echo ""
  echo -e "${DIM}Shutting down...${RESET}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo -e "${DIM}All services stopped.${RESET}"
}

trap cleanup EXIT INT TERM

# ── Start services ──

echo -e "${DIM}Starting Orchestrator    → http://localhost:4312${RESET}"
node orchestrator/server.js &
PIDS+=($!)

echo -e "${DIM}Starting FlowDrip        → http://localhost:3000${RESET}"
(cd flowdrip && npx next dev --port 3000) &
PIDS+=($!)

echo -e "${DIM}Starting Ad Generator    → http://localhost:3001${RESET}"
(cd ad-generator && npx tsx server/api.ts &
 npx vite --port 3001) &
PIDS+=($!)

# Give services a moment to boot
sleep 3

echo -e "${DIM}Starting Hub             → http://localhost:4000${RESET}"
node hub/server.js &
PIDS+=($!)

echo ""
echo -e "${GREEN}All services running.${RESET}"
echo ""
echo "  Hub            http://localhost:4000"
echo "  FlowDrip       http://localhost:3000"
echo "  Ad Generator   http://localhost:3001"
echo "  Orchestrator   http://localhost:4312"
echo ""
echo -e "${DIM}Press Ctrl+C to stop all services.${RESET}"
echo ""

# Wait for any child to exit
wait
