# Rating Hub — Project Policy & Decisions

## Project Overview

Pickleball rating hub for White Mountain Pickleball Club (WMPC). Tracks player ratings, game stats, and coaching insights from PB Vision AI-analyzed game footage.

## Coach Workflow (canonical)

This is the mental model the app is built around. Design decisions reference
back to this flow.

1. **Game Stats glance.** Coach opens a game and gets a high-level read on how
   each player performed (existing Game Detail page).
2. **Analyze phase.** Coach watches rallies in sequence. While watching they
   **tag/flag** moments that need follow-up. Two shapes of tag:
   - **Flagged shot** — a single shot worth reviewing.
   - **Sequence** — a contiguous set of shots in a rally, optionally tagged to
     one or more players.
   Tags are *not* player-focused at this stage — the coach is watching the
   whole rally and marking whatever stands out (good or bad).
3. **Review phase.** Coach switches to the Review tab and picks a player. The
   app shows every review item that involves that player:
   - Coach-tagged flags and sequences from Analyze.
   - Auto-detected pattern issues (First-4-Shots script misses, Defensive
     Beats by location / body, and more club-level analytics to come).
   - Rally losses the player was personally attributed to.
4. **Per-item coaching.** For each review item the coach sees a clip on loop
   (the sequence shots only, or the whole rally when no tighter clip exists),
   applies **FPTM** diagnosis (Footwork / Paddle / Tactics / Mindset, with
   strength vs needs-work tone), adds drills and free-form notes.
5. **Report card.** After all items are reviewed, the coach writes overall
   notes on the player — this becomes their digital report card.

**Key consequences for UI:**
- The Review page is per-player *by design*. Player picker lives at the top.
- Every review item — regardless of source — uses the **same** review shell:
  clip on loop + FPTM editor + notes. Sources differ; treatment is uniform.
- Pattern analytics (First 4 Shots, Defensive Beats, etc.) are *sources that
  feed the queue*, not separate destinations. Drill-downs on stats should
  either enqueue items for review or open the standard review shell directly.

## End-to-End Session Workflow

This is the canonical flow from scheduling to coach analysis. It spans two projects:
`session-manager` (scheduling, recording, splitting, PB Vision upload) and `rating-hub` (this project:
importing PB Vision data, visualizing, coach analysis).

**The single source of truth for this flow lives here. `session-manager`'s CLAUDE.md should link back.**

### Lifecycle

1. **Schedule** — Players book a rating session (session-manager)
2. **Record** — Camera captures the whole session as one video (session-manager)
3. **Split** — Session video is split into per-game videos (session-manager)
4. **Upload** — Game videos are uploaded to PB Vision via their Partner API (session-manager)
5. **AI processing** — PB Vision produces insights JSON + rating + Mux playback ID (PB Vision, async)
6. **Session init** — A `sessions` row is created in rating-hub DB (session-manager pushes)
7. **Auto-import (partial)** — PB Vision's webhook fires when a video finishes processing →
   rating-hub's `pbvision-webhook` Edge Function imports compact insights → creates `games`,
   `game_players`, `rallies`, `rally_shots`, `player_rating_snapshots` rows. Players are auto-named
   `Player 0`, `Player 1`, etc. until step 8.
8. **Tag players on PB Vision** — A human logs into pb.vision and tags each "Player N" with a real
   name. This updates PB Vision's Firestore; insights JSON regenerates with real names.
9. **Refresh + enrich** — session-manager (which has pb.vision auth) pulls the final data: real
   player names, Mux playback ID, stats.json, and pushes to rating-hub via webhook. Rating-hub
   re-imports to replace placeholder data.
10. **Session complete** — Coach can now analyze games on rating-hub.

### Where each step lives

| Step | Owner | Why |
|---|---|---|
| 1-4 (schedule → upload) | session-manager | Has camera pipeline + pb.vision Partner API auth |
| 5 (AI processing) | PB Vision | Their infrastructure |
| 6 (session init) | session-manager → rating-hub | Push via direct DB insert or webhook |
| 7 (AFTER tagging: import compact + augmented + avatars) | rating-hub | Public PB Vision API and GCS serve all of this without auth, INCLUDING tagged player names |
| 8 (tag players) | Human, on pb.vision UI | Only their UI supports this |
| 9 (refresh Mux playback ID + stats.json) | session-manager → rating-hub | pb.vision auth is required for: Mux playback ID (Firestore) and stats.json (non-public) |
| 10 (coach analysis) | rating-hub | This project |

### What the public PB Vision API exposes (verified 2026-04-19)

This is surprising — more is public than we initially thought. No auth required:

- **Compact insights** — `GET https://api-2o2klzx4pa-uc.a.run.app/video/{videoId}/insights.json?sessionNum={n}&format=compact` (HTTP 200)
- **Augmented insights** — same URL with `format=augmented` (HTTP 200, ~5× larger, readable field names)
- **Tagged player names** — returned in both compact `pd[].name` and augmented `player_data[].name` AFTER tagging is complete on pb.vision. Before tagging, these are `"Player 0"` etc.
- **Player avatar images** — `https://storage.googleapis.com/pbv-pro/{videoId}/{aiEngineVersion}/player{avatar_id}-0.jpg`. `aiEngineVersion` comes from the insights JSON's `sm.aiEngineVersion` (compact) or `serverMetadata.aiEngineVersion` (augmented). `avatar_id` comes from `pd[].avatar_id`.
- **Poster/thumbnail** — `https://storage.googleapis.com/pbv-pro/{videoId}/poster.jpg`
- **Insights API accepts both `sessionNum=0` and `sessionNum=1`** and returns the same data. We use 0 for consistency with the webhook's existing behavior.

What's NOT public:

- **`format=stats`** — returns HTTP 400 `{code, message}`. Only accessible via pb.vision login.
- **Mux playback ID** — in pb.vision's private Firestore at `pbv-prod/videos/{vid}` under `mux.playbackId`. Required to stream the video in our Analyze page.
- **Listing a user's videos** — no REST endpoint; requires Firestore client SDK with auth.

### Why the split now makes sense

- **rating-hub can fetch nearly everything it needs directly** — as long as the webhook fires AFTER tagging is complete. No session-manager participation required for compact, augmented, player names, or avatars.
- **session-manager only needs to push Phase 2 for**: Mux playback ID (always needed for video) and stats.json (nice-to-have).
- **session-manager must delay the initial webhook call until tagging is done** — otherwise rating-hub imports players with placeholder names ("Player 0") and then must reconcile later.

### Rating-hub webhook contract (simplified — delay-until-tagged approach)

Only ONE call per game from session-manager. session-manager must wait until tagging is complete
before firing this:

```
POST /functions/v1/pbvision-webhook
Authorization: Bearer <WEBHOOK_SECRET>
{
  "videoId": "abc123",
  "sessionId": "optional-session-uuid",
  "muxPlaybackId": "a00w01bJI01Ax..."   // optional; enables video playback
}
```

Rating-hub then:
1. Fetches **compact** insights from the public API → imports games, game_players, players (by real name), rallies, rally_shots, rating snapshots
2. Fetches **augmented** insights from the public API → merges highlights + advanced stats
3. Derives **player avatar URLs** from `aiEngineVersion` + `avatar_id` → stores on `players.avatar_url`
4. If `muxPlaybackId` provided → saves to `games.mux_playback_id`

session-manager can optionally push `statsJson` in the payload later if we decide we need the
shot-type/court-zone breakdowns that aren't in augmented. For now we skip stats.

### Player name mapping

Because we delay the webhook until after tagging, player names arrive real (not "Player 0"). The
existing `findOrCreatePlayer` logic in `lib/importPbVision.ts` matches by `pbvision_names` array
first, then slug, and creates new players if no match. No reconciliation logic needed.

If the webhook is accidentally fired before tagging, placeholder players will be created. Fix is
to re-fire the webhook after tagging — our import is idempotent on `(org_id, videoId, sessionIndex)`,
so the game row is reused; existing `findOrCreatePlayer` matches the new real names against
existing players.

### Current status (as of 2026-04-19)

- ✅ Phase 1 webhook works (manual import via web UI; auto-webhook for camera system) — imports compact insights
- ⬜ Webhook does NOT yet fetch augmented insights automatically (needed for highlights + advanced stats)
- ⬜ Webhook does NOT yet derive/save player avatar URLs
- ⬜ Webhook does NOT yet accept `muxPlaybackId` in payload
- ⬜ session-manager has not been updated to delay the webhook until tagging is complete
- Workaround for Mux: Coach pastes Mux playback ID manually via the `📌 PBV Grab` bookmarklet on
  `/pbv-link?pbv=X&mux=Y`. Keep this as the fallback even after session-manager handles it.

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

- **Supabase** is the sole production database. Firebase has been fully removed from the web app (no firebase.ts, no auth provider, no Firestore queries).
- Multi-tenant via `organizations` table. Current org slug: `wmpc`, UUID: `0dcc373f-dbee-414b-9e87-a0a5fd67bef5`.
- All tables use Row Level Security with public read / authenticated write policies. Dev-mode "allow all" write policies are active for development.
- Migrations live in both `db/migrations/` (source of truth) and `supabase/migrations/` (for `supabase db push`).
- **Schema design philosophy**: Ratings are typed NUMERIC columns (indexed, sortable for leaderboards). Shot distributions, coaching advice, and advanced stats are JSONB (flexible, display-oriented). `raw_game_data` and `raw_player_data` JSONB columns preserve original data for forward compatibility.
- **7 core tables**: `organizations`, `players`, `games`, `game_players`, `rallies`, `player_rating_snapshots`, `player_aggregates`.
- **2 enrichment tables** (added in 002): `game_player_shot_types` (per shot type per player per game), `game_player_court_zones` (per court zone per player per game).
- **2 views**: `v_leaderboard` (player rankings), `v_player_game_history` (player game log).
- **1 RPC function**: `refresh_player_aggregates(player_id)` — must be called after any game import to update latest/avg/peak ratings and win rate.
- Rally data stored at summary level only (timing, score, winning team, shot count) — no individual shot-level records.

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
- Player slug is generated by lowercasing and replacing non-alphanumeric chars with hyphens.

### Web App UI

- **No Firebase auth** — Firebase Auth, AuthProvider, RequireAuth, and LoginPage have been removed. Auth will be revisited later (likely Supabase Auth).
- **Layout**: Sidebar navigation (`AdminLayout`) wrapping all org-scoped routes via React Router nested `<Outlet />`.
- **Styling**: Inline styles with system-ui font, no CSS framework or component library. Consistent spacing, border, and color patterns.
- **Route structure**:
  - `/` — Org picker (Supabase query)
  - `/org/:orgId/players` — Player leaderboard (sortable table from `v_leaderboard`)
  - `/org/:orgId/players/:slug` — Player detail (aggregate stats + rating cards + game history)
  - `/org/:orgId/games` — Game list with player names
  - `/org/:orgId/games/:gameId` — Game detail with expandable per-player stat cards (ratings, shot quality/selection/accuracy, shot type breakdowns, court zones)
  - `/org/:orgId/import` — Multi-format JSON import UI
- **Import UI auto-sorts files**: When multiple files are uploaded, compact format is processed first (creates games/players), then stats (enriches with shot type breakdowns), then augmented insights (adds highlights + advanced stats). All three formats for the same game can be uploaded in one batch.
- **Supabase client** configured via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars in `web/.env.local`.

### Data Import Formats

- **Compact** (`ses`, `ral`, `gd`, `pd`, `ca`, `sm`): Primary format. Creates game, players, game_players, rallies, rating snapshots. Also handles `{prompt, data}` wrapper from PB Vision downloads.
- **Stats** (`version`, `session`, `game`, `players`): Enriches existing game with per-shot-type breakdowns (19 types), court zone breakdowns (8 zones), ball directions, volley/ground stroke counts, fault percentages.
- **Augmented insights** (`version`, `session`, `player_data`, `highlights`, `stats`): Enriches existing game with highlights (auto-detected exciting moments) and 119 advanced per-player metrics.
- Stats and augmented insights require the game to already exist from a compact import — they update existing rows, not create new ones.

### AI Common Themes (added 2026-04-22)

Session-level coaching takeaways generated by Claude over all of a
player's games in a session.

- **Table**: `player_coaching_themes` (migration 019). Scoped to
  `(org, player, session)`. Each row has `title`, `problem`, `solution`,
  `source ∈ ('ai', 'coach')`, `edited`. Coach edits flip `edited = true`
  and `source = 'coach'` so the next Generate pass preserves them.
- **Edge function**: `supabase/functions/generate-themes` — pulls every
  per-player data point (ratings, serve/return depth, kitchen arrival %,
  coach's overall notes, FPTM blobs, flagged moments, sequence notes,
  topic recommendations) per game, builds a structured prompt, calls
  Claude, persists the results (replacing un-edited AI rows only).
- **Prompt** lives inline in `index.ts`. Asks for EXACTLY N JSON objects
  with `title`/`problem`/`solution`; defensively strips ```json fences
  that the model occasionally adds despite the instruction.
- **Default model**: `claude-haiku-4-5-20251001`. Override via
  `THEMES_MODEL` env var on the function.
- **UI**: `components/report/CommonThemesPanel.tsx` surfaced on the
  Session Report. Inline-editable; any edit auto-saves on blur and marks
  the row as coach-edited.
- **Cost**: ~$0.01 per Generate click on Haiku 4.5 for a 4-game session.

## Directory Structure

```
web/                          # React SPA (Vite)
  src/
    admin/ImportPbVisionJson.tsx  # Manual JSON upload UI (auto-detect + sort)
    components/AdminLayout.tsx    # Sidebar nav layout with Outlet
    lib/importPbVision.ts         # Import logic (all 3 formats)
    pages/
      OrgPickerPage.tsx           # Org selection (Supabase)
      PlayerListPage.tsx          # Sortable leaderboard from v_leaderboard
      PlayerDetailPage.tsx        # Aggregate stats + game history
      GameListPage.tsx            # All games with player names
      GameDetailPage.tsx          # Game detail with expandable player cards
      ImportPage.tsx              # Wrapper for ImportPbVisionJson
    supabase.ts                   # Supabase client config
    types/database.ts             # TypeScript interfaces for all tables/views
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
# Shared secret the browser sends to edge functions. Must equal
# WEBHOOK_SECRET below. NEVER put ANTHROPIC_API_KEY here — VITE_* vars
# are bundled into the browser.
VITE_COACH_AI_SECRET=<bearer token, same value as WEBHOOK_SECRET>
```

### Edge function secrets (set via `supabase secrets set`)
```
ORG_SLUG=wmpc
WEBHOOK_SECRET=<bearer token for webhook + themes function auth>
# Required for the generate-themes function. Get from console.anthropic.com.
ANTHROPIC_API_KEY=sk-ant-api03-...
# Optional — override the Claude model. Default is claude-haiku-4-5-20251001.
# Use scripts/probe-anthropic-models.mjs to see what your key can access.
THEMES_MODEL=claude-haiku-4-5-20251001
```

**Secrets contract in one picture.** Browser → edge function is authed by
`VITE_COACH_AI_SECRET` (client) / `WEBHOOK_SECRET` (server) — same value,
two places. Edge function → Anthropic is authed by `ANTHROPIC_API_KEY`,
which only ever lives server-side. Keeping these separate prevents Anthropic
credits from being burned by anyone who scrapes the client bundle.

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

# Deploy edge functions
supabase functions deploy pbvision-webhook --no-verify-jwt
supabase functions deploy generate-themes --no-verify-jwt

# Smoke-test the Common-Themes feature end-to-end
node scripts/test-coaching-themes.mjs [sessionId] [playerId]

# List Claude models available to your Anthropic key
ANTHROPIC_API_KEY=sk-ant-... node scripts/probe-anthropic-models.mjs

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
- No CI/CD pipeline configured yet.
- No auth on the web app yet — Firebase Auth was removed. Supabase Auth is the likely replacement. Currently relies on RLS public read + dev-mode write policies.
- Dev-mode RLS "allow all" write policies should be replaced with proper auth-gated policies before production.
- Node installation on dev machine has a broken symlink (`/opt/homebrew/bin/node` → uninstalled Cellar version). Fix with `brew reinstall node`. Use `id_ed25519_notronwest` SSH key for GitHub pushes.
- Supabase free tier pauses projects after 7 days of inactivity. Pro plan ($25/mo) removes this if needed.
- `firebase` package is still in `web/package.json` dependencies — can be removed since all Firebase code has been deleted from the app.

### Pick up next session (added 2026-04-24)

- **Shot geometry is missing on every webhook-imported game.** `supabase/functions/pbvision-webhook/index.ts` fetches augmented insights but never writes per-shot geometry into `rally_shots` (the geometry extractor lives in `web/src/lib/importPbVision.ts` only). Two-part fix: **(a)** run `scripts/reimport-shot-geometry.mjs` to backfill every existing game; **(b)** port the geometry extraction block from `lib/importPbVision.ts` into the edge function so future webhook imports populate geometry on the way in. Symptom: Patterns Toolbar shows "No shot geometry yet — re-import augmented insights to populate."
- **Stat Review clip cuts off before rally end on some rallies.** Game `203e43ce-de5c-4536-9433-81b0bd7b9435`, rally 1 (Celeste serving) — the looped clip ends before the point completes, so the coach can't see why PB Vision dinged Celeste for not getting to the kitchen. The Stat Review TopicItem reuses WMPC's clip-loop (`CLIP_LOOP_MS = 5000` in `WmpcAnalysisPanel.tsx`); for stat-review topics the loop should run from `rally.start_ms` through `rally.end_ms` (rally-scoped) instead of a fixed 5s window from `seekMs`. Investigate and adjust the loop bounds for stat-review instances specifically — WMPC topics still want the tight 5s window.
