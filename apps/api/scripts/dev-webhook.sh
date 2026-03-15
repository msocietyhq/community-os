#!/usr/bin/env bash
# Starts a Cloudflare Tunnel for local bot webhook development.
# Sets WEBHOOK_URL and WEBHOOK_SECRET env vars, then starts the API server.
# Usage: ./scripts/dev-webhook.sh

set -euo pipefail

PORT="${PORT:-3000}"
SECRET="${WEBHOOK_SECRET:-$(openssl rand -hex 32)}"

# Start cloudflared tunnel in background, capture the URL
TUNNEL_LOG=$(mktemp)
cloudflared tunnel --url "http://localhost:${PORT}" --no-tls-verify 2>"$TUNNEL_LOG" &
TUNNEL_PID=$!

cleanup() {
  echo ""
  echo "Shutting down tunnel (PID $TUNNEL_PID)..."
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT

# Wait for cloudflared to print the tunnel URL
echo "Starting Cloudflare Tunnel..."
WEBHOOK_URL=""
for i in $(seq 1 30); do
  WEBHOOK_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
  if [ -n "$WEBHOOK_URL" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "$WEBHOOK_URL" ]; then
  echo "ERROR: Could not get tunnel URL after 15s. cloudflared logs:"
  cat "$TUNNEL_LOG"
  exit 1
fi

TUNNEL_HOST=$(echo "$WEBHOOK_URL" | sed 's|https://||')

# Wait for the tunnel to actually be reachable (DNS + tunnel established)
echo "Waiting for tunnel to be reachable..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "https://${TUNNEL_HOST}" 2>/dev/null; then
    break
  fi
  # Accept 502 too — means DNS resolved but origin not up yet (expected)
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "https://${TUNNEL_HOST}" 2>/dev/null || true)
  if [ "$HTTP_CODE" = "502" ]; then
    break
  fi
  sleep 1
done

WEBHOOK_URL="${WEBHOOK_URL}/api/v1/bot/webhook"
echo "Tunnel ready: $WEBHOOK_URL"
echo ""

# Start the API server with webhook env vars
WEBHOOK_URL="$WEBHOOK_URL" \
WEBHOOK_SECRET="$SECRET" \
PORT="$PORT" \
exec bun run --watch src/index.ts
