#!/bin/bash
# maw boot script — ensures correct repo, latest version, all services
# Usage: bash scripts/boot.sh
# Called manually or by pm2/systemd on startup

set -e

MAW_ROOT="/home/mbank/repos/github.com/BankCurfew/maw-js"
cd "$MAW_ROOT"

echo "[boot] cwd: $MAW_ROOT"

# 1. Ensure correct branch + latest
BRANCH=$(git branch --show-current)
echo "[boot] branch: $BRANCH"
git pull origin "$BRANCH" --ff-only 2>/dev/null && echo "[boot] pulled latest" || echo "[boot] already up to date"
echo "[boot] version: $(git describe --tags 2>/dev/null || git log --oneline -1)"

# 2. Install deps if needed
if [ ! -d node_modules/hono ]; then
  echo "[boot] installing dependencies..."
  bun install --frozen-lockfile 2>/dev/null || bun install
fi

# 3. Kill stale port holders
for port in 3456; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "[boot] killing stale process on :$port (pid $pid)"
    kill -9 $pid 2>/dev/null || true
    sleep 1
  fi
done

# 4. Start maw via pm2
pm2 delete maw 2>/dev/null || true
pm2 start "$MAW_ROOT/ecosystem.config.cjs" --only maw
sleep 3

# 5. Verify services
echo ""
echo "=== Service Verification ==="

# Dashboard :3456
if curl -s -o /dev/null -w "" http://localhost:3456/ 2>/dev/null; then
  echo "[✓] Dashboard :3456 — OK"
else
  echo "[✗] Dashboard :3456 — FAILED"
fi

# LINE webhook :3200
if curl -s http://localhost:3200/health 2>/dev/null | grep -q "ok"; then
  echo "[✓] LINE webhook :3200 — OK"
else
  echo "[!] LINE webhook :3200 — not running (separate process)"
fi

# Oracle API
if pm2 list 2>/dev/null | grep -q "oracle-api.*online"; then
  echo "[✓] Oracle API — OK"
else
  echo "[!] Oracle API — not running"
fi

# CF tunnel
if pm2 list 2>/dev/null | grep -q "cloudflared.*online"; then
  echo "[✓] Cloudflare tunnel — OK"
else
  echo "[!] Cloudflare tunnel — not running"
fi

# rooms.json check
if grep -q "Doc-Oracle" "$MAW_ROOT/rooms.json" 2>/dev/null; then
  DOC_ROOM=$(grep -B10 "Doc-Oracle" "$MAW_ROOT/rooms.json" | grep '"id"' | tail -1 | grep -o '"[^"]*"' | tail -1 | tr -d '"')
  echo "[✓] DocCon Oracle → $DOC_ROOM"
else
  echo "[!] Doc-Oracle not found in rooms.json"
fi

if grep -q "Cost-Oracle" "$MAW_ROOT/rooms.json" 2>/dev/null; then
  COST_ROOM=$(grep -B10 "Cost-Oracle" "$MAW_ROOT/rooms.json" | grep '"id"' | tail -1 | grep -o '"[^"]*"' | tail -1 | tr -d '"')
  echo "[✓] Cost Oracle → $COST_ROOM"
else
  echo "[!] Cost-Oracle not found in rooms.json"
fi

echo ""
echo "[boot] done — maw running from $MAW_ROOT"
