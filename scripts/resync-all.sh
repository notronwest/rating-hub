#!/usr/bin/env bash
# Re-syncs all existing games in the rating-hub DB by calling the webhook
# for each unique pbvision_video_id. Safe to run repeatedly — imports are
# idempotent on (org_id, videoId, sessionIndex).
#
# Usage:
#   ./scripts/resync-all.sh
#
# Env vars (defaults baked in for WMPC dev):
#   WEBHOOK_URL     - Supabase function URL
#   WEBHOOK_SECRET  - Bearer token
#   SUPABASE_URL    - DB URL for listing IDs
#   SUPABASE_KEY    - anon/publishable key for listing IDs

set -euo pipefail

: "${WEBHOOK_URL:=https://cjtfhegtgbfwccnruood.supabase.co/functions/v1/pbvision-webhook}"
: "${WEBHOOK_SECRET:=wmpc-pbv-webhook-2026}"
: "${SUPABASE_URL:=https://cjtfhegtgbfwccnruood.supabase.co}"
: "${SUPABASE_KEY:=sb_publishable_4MXrC1eMhONRRABwYWX7Bg_s2wAwA1g}"

# Fetch all unique video IDs
echo "Fetching video IDs from DB…"
ids=$(curl -s "$SUPABASE_URL/rest/v1/games?select=pbvision_video_id&order=played_at.asc" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  | python3 -c "
import json, sys
ids = sorted({g['pbvision_video_id'] for g in json.load(sys.stdin)})
print('\n'.join(ids))
")

count=$(echo "$ids" | wc -l | tr -d ' ')
echo "Found $count unique videos. Starting sync…"
echo

i=0
for vid in $ids; do
  i=$((i+1))
  printf "[%d/%d] %s … " "$i" "$count" "$vid"
  resp=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"videoId\":\"$vid\"}")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" = "200" ]; then
    echo "$body" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(f\"✓ {d.get('sessionsImported',0)} sessions, {d.get('totalShots',0)} shots\")
except Exception as e:
    print('?', e)
"
  else
    echo "✗ HTTP $code"
    echo "    $body"
  fi

  # Be polite to the server
  sleep 0.3
done

echo
echo "Done."
