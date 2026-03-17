#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUDFLARE_DIR="$SCRIPT_DIR/../cloudflare"
TUNNEL_LOG="/tmp/nitter-tunnel.log"
DB_NAME="socia-research"

cd "$SCRIPT_DIR"

echo "=== Socia Research — Nitter Local ==="

# ── Dependency checks ────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "❌ Docker not found. Install: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! command -v cloudflared &>/dev/null; then
  echo "📦 Installing cloudflared via Homebrew..."
  brew install cloudflare/cloudflare/cloudflared || {
    echo "❌ Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
  }
fi

if ! command -v wrangler &>/dev/null && ! npx wrangler --version &>/dev/null 2>&1; then
  echo "❌ wrangler not found. Run: npm install -g wrangler"
  exit 1
fi

# ── Start Nitter + Redis ─────────────────────────────────────────────────────

echo ""
echo "🐦 Starting Nitter + Redis..."
docker compose up -d --pull always

echo "⏳ Waiting for Nitter to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/sama/rss > /dev/null 2>&1; then
    echo "✅ Nitter ready at http://localhost:8080"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "⚠️  Nitter not responding. Check logs: docker compose logs nitter"
    exit 1
  fi
  printf "."
  sleep 2
done

# ── Start Cloudflare Tunnel ──────────────────────────────────────────────────

echo ""
echo "🌐 Opening Cloudflare Tunnel..."
rm -f "$TUNNEL_LOG"
cloudflared tunnel --url http://localhost:8080 2>&1 | tee "$TUNNEL_LOG" &
TUNNEL_PID=$!

# Wait for URL to appear in log (up to 20s)
TUNNEL_URL=""
for i in $(seq 1 20); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
  [ -n "$TUNNEL_URL" ] && break
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ Could not detect tunnel URL. Check $TUNNEL_LOG"
  kill "$TUNNEL_PID" 2>/dev/null
  docker compose down
  exit 1
fi

echo "✅ Tunnel URL: $TUNNEL_URL"

# ── Auto-update D1 source config ─────────────────────────────────────────────

echo ""
echo "🔄 Updating x_rss source config in Cloudflare D1..."

NEW_CONFIG="{\"nitter_instance\":\"${TUNNEL_URL}\",\"include_retweets\":false,\"lookback_days\":7}"

# Update all x_rss sources to use new tunnel URL
UPDATE_SQL="UPDATE sources SET is_active=1, config=json_patch(config, json_object('nitter_instance','${TUNNEL_URL}')) WHERE connector_type='x_rss';"

cd "$CLOUDFLARE_DIR"
npx wrangler d1 execute "$DB_NAME" --remote --command "$UPDATE_SQL" 2>&1 | grep -E '"changes"|error' | head -3

# Verify
RESULT=$(npx wrangler d1 execute "$DB_NAME" --remote \
  --command "SELECT name, config FROM sources WHERE connector_type='x_rss' AND is_active=1;" \
  2>/dev/null | grep -A5 '"results"' | grep -E 'name|nitter_instance' | head -4)

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Nitter is LIVE and D1 config updated                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  Tunnel: %-52s║\n" "$TUNNEL_URL"
echo "║                                                              ║"
echo "║  Sources updated and enabled — click ▶ Run in Admin UI      ║"
echo "║  or wait for the next cron (every 30 min)                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Admin UI: https://socia-research.trungnguyen6890.workers.dev/admin/"
echo "  Test RSS: curl $TUNNEL_URL/sama/rss | head -5"
echo ""
echo "  Press Ctrl+C to stop Nitter and close the tunnel."
echo ""

# ── Cleanup on Ctrl+C ────────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo "🛑 Shutting down..."

  # Disable x_rss sources so cron doesn't error when tunnel is gone
  cd "$CLOUDFLARE_DIR"
  npx wrangler d1 execute "$DB_NAME" --remote \
    --command "UPDATE sources SET is_active=0 WHERE connector_type='x_rss';" \
    2>/dev/null | grep '"changes"' | head -1
  echo "   x_rss sources disabled in D1"

  kill "$TUNNEL_PID" 2>/dev/null
  cd "$SCRIPT_DIR"
  docker compose down
  echo "   Done."
}

trap cleanup EXIT INT TERM

# Keep alive
wait "$TUNNEL_PID"
