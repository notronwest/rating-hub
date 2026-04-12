# Rating Hub — Project Policy & Decisions

## Project Overview

Pickleball rating hub for White Mountain Pickleball Club (WMPC). Tracks player ratings, game stats, and coaching insights from PB Vision AI-analyzed game footage.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite (SPA)
- **Database**: Supabase (PostgreSQL + Row Level Security)
- **Edge Functions**: Supabase Edge Functions (Deno runtime)
- **PB Vision Integration**: Public insights API + webhook-based auto-import
- **Deployment**: Static SPA (Vite build) + Supabase hosted backend
- **Package manager**: npm
- **Node version**: 18+ (installed via Homebrew)

## Architecture Decisions

### Database

- **Supabase** is the sole production database. Firebase is legacy (scripts only) and should not be used for new features.
- Multi-tenant via `organizations` table. Current org slug: `wmpc`, UUID: `0dcc373f-dbee-414b-9e87-a0a5fd67bef5`.
- All tables use Row Level Security with public read / authenticated write policies.
- Migrations live in both `db/migrations/` (source of truth) and `supabase/migrations/` (for `supabase db push`).

### PB Vision Integration

- **Insights API is public** — no auth required: `https://api-2o2klzx4pa-uc.a.run.app/video/{videoId}/insights.json?sessionNum={n}&format=compact`
- **Listing a user's videos requires Firestore client SDK** — there is no REST API to enumerate videos in a pb.vision account. Video IDs must be scraped from the pb.vision library UI or provided by the uploading application.
- **Firebase project**: `pbv-prod` (pb.vision's backend, not ours)
- **GCS bucket for thumbnails**: `pbv-pro`
- Three JSON formats exist: compact (primary), augmented insights, and stats. The webhook and sync script import compact format. The web UI (`ImportPbVisionJson.tsx`) handles all three.

### Webhook Auto-Import

- A camera system uploads videos to pb.vision via their Partner API.
- After processing, the camera app calls our Supabase Edge Function with the video ID.
- **Endpoint**: `POST https://cjtfhegtgbfwccnruood.supabase.co/functions/v1/pbvision-webhook`
- **Auth**: Bearer token via `WEBHOOK_SECRET` env var (currently `wmpc-pbv-webhook-2026` — should be rotated for production)
- **Payload**: `{ "videoId": "abc123", "sessionId": "optional" }`
- The function downloads compact insights, imports games/players/rallies/rating snapshots, and logs to `webhook_logs` table.
- Edge function secrets: `ORG_SLUG=wmpc`, `WEBHOOK_SECRET`, plus auto-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Deployed with `--no-verify-jwt` since we use our own Bearer token auth.

### Player Matching

- Players are matched by `pbvision_names` array first, then by slug.
- New players are auto-created on import.
- A single player can have multiple PB Vision display names (tracked in `pbvision_names` column).

## Directory Structure

```
web/                          # React SPA (Vite)
  src/
    admin/ImportPbVisionJson.tsx  # Manual JSON upload UI
    lib/importPbVision.ts         # Import logic (all 3 formats)
    supabase.ts                   # Supabase client config
  .env.local                      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

db/migrations/                # SQL migrations (source of truth)
supabase/
  functions/pbvision-webhook/ # Edge function for auto-import
  migrations/                 # Copies for `supabase db push`
  config.toml                 # Supabase CLI config

scripts/
  sync-pbvision.mjs           # CLI bulk download + import
  extract-pbvision-ids.js     # Browser console script to scrape video IDs

data/pbvision/                # Downloaded insights JSON files + video-ids.txt
```

## Environment Variables

### Web app (`web/.env.local`)
```
VITE_SUPABASE_URL=https://cjtfhegtgbfwccnruood.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

### Edge function secrets (set via `supabase secrets set`)
```
ORG_SLUG=wmpc
WEBHOOK_SECRET=<bearer token for webhook auth>
```

### CLI scripts (optional, reads from web/.env.local if not set)
```
SUPABASE_URL / VITE_SUPABASE_URL
SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY
ORG_ID=wmpc
```

## Conventions

- **Commits**: Concise message explaining "why", co-authored by Claude.
- **Imports**: Prefer upsert with `onConflict` for idempotent imports.
- **Player aggregates**: Call `refresh_player_aggregates` RPC after any game import.
- **Git**: `supabase/.temp/` should be gitignored. `data/pbvision/*.json` files are local cache, not committed.
- **Edge functions**: Use Deno imports (`https://esm.sh/`) not npm. Service role key for full DB access.

## Common Commands

```bash
# Dev server
cd web && npm run dev

# Deploy edge function
supabase functions deploy pbvision-webhook --no-verify-jwt

# Push DB migrations
supabase db push

# Bulk sync existing videos
node scripts/sync-pbvision.mjs --ids-file data/pbvision/video-ids.txt

# Import already-downloaded JSON files
node scripts/sync-pbvision.mjs --import-only

# Test webhook
curl -X POST https://cjtfhegtgbfwccnruood.supabase.co/functions/v1/pbvision-webhook \
  -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" \
  -d '{"videoId": "abc123"}'
```

## Known Issues & TODOs

- `scripts/import-pbvision-json.mjs` has a bug on line 22 (undefined `wmpcmemberhub` variable). This script is legacy/unused — use `sync-pbvision.mjs` instead.
- Webhook secret should be rotated before production use.
- `data/pbvision/` and `supabase/.temp/` should be added to `.gitignore`.
- No CI/CD pipeline configured yet.
- No server-side auth for the web app — relies entirely on Supabase RLS.
