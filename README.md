# rating-hub

Pickleball rating hub for White Mountain Pickleball Club. React 18 + TypeScript + Vite SPA backed by Supabase (Postgres + Edge Functions), deployed on Cloudflare Workers, and fed by PB Vision's AI-analyzed game footage.

`CLAUDE.md` has the deeper architecture + decision history. This README is the **getting-started runbook** for bringing up a new instance (new club / new dev machine / new Supabase project).

---

## TL;DR — bring up a new instance

```bash
# ── Per-project (once) ─────────────────────────────────────────
git clone <repo-url> && cd wmpc_rating_hub
(cd web && npm install)

# Supabase side
supabase link --project-ref <ref>
supabase db push
supabase secrets set \
  WEBHOOK_SECRET=<random-string> \
  ORG_SLUG=<org-slug> \
  ANTHROPIC_API_KEY=sk-ant-api03-...
supabase functions deploy pbvision-webhook --no-verify-jwt
supabase functions deploy generate-themes --no-verify-jwt

# Cloudflare side — set these as Build variables in the Workers dashboard:
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_COACH_AI_SECRET
# (VITE_COACH_AI_SECRET must equal WEBHOOK_SECRET above.)
# Then: push to main → Cloudflare builds from web/ and deploys dist/.

# ── Per-dev-machine ─────────────────────────────────────────────
cat > web/.env.local <<EOF
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_COACH_AI_SECRET=<same value as WEBHOOK_SECRET above>
EOF

# Verify everything is wired up
node scripts/test-coaching-themes.mjs         # config-only checks
node scripts/test-coaching-themes.mjs <sessionId> <playerId>  # full E2E

# Work
cd web && npm run dev
```

See the numbered sections below for details on each step.

---

## 1. Prerequisites

- **Node 18+** — `brew install node`
- **Supabase CLI** — `brew install supabase/tap/supabase`
- **Anthropic API key** — sign up at [console.anthropic.com](https://console.anthropic.com), add billing, create a key. Starts with `sk-ant-api03-...`. Needed for the AI Common-Themes feature.
- A Supabase project (free tier is fine for dev — Pro if you don't want it to pause after 7 days of inactivity).

---

## 2. Clone + install

```bash
git clone <repo-url>
cd wmpc_rating_hub/web
npm install
```

---

## 3. Environment variables

### Client — `web/.env.local`

```bash
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase → Project Settings → API>

# Shared secret the browser sends to your edge functions.
# Pick any random string — it must match WEBHOOK_SECRET on the edge-function side.
# Same value is used for pbvision-webhook and generate-themes.
VITE_COACH_AI_SECRET=<random-string>
```

> **Do NOT put `ANTHROPIC_API_KEY` in `.env.local`.** Anything prefixed `VITE_*` is shipped to the browser; the Anthropic key must stay server-side only.

---

## 4. Database setup

The schema is tracked as numbered SQL files under `db/migrations/` (source of truth) and mirrored into `supabase/migrations/` for `supabase db push`.

Link the project and apply migrations:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Then seed one organization and at least one player / game via the web app's Import page, or via the `sync-pbvision.mjs` CLI (see § 8).

---

## 5. Edge Functions

Two functions live under `supabase/functions/`:

| Function | Purpose | Required secrets |
|---|---|---|
| `pbvision-webhook` | Auto-imports insights when PB Vision finishes processing a game | `WEBHOOK_SECRET`, `ORG_SLUG` |
| `generate-themes` | Calls Claude over a player's session to produce coaching themes | `WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, optional `THEMES_MODEL` |

### Set secrets (once per project)

```bash
# The shared browser↔function secret — same value as VITE_COACH_AI_SECRET in .env.local
supabase secrets set WEBHOOK_SECRET=<random-string>

# Your Anthropic key. NEVER put this in .env.local.
supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...

# Org slug — used by pbvision-webhook to find the right tenant
supabase secrets set ORG_SLUG=wmpc

# (optional) override the Claude model generate-themes uses. Default is
# claude-haiku-4-5-20251001.
supabase secrets set THEMES_MODEL=claude-haiku-4-5-20251001

# Verify
supabase secrets list
```

### Deploy

```bash
supabase functions deploy pbvision-webhook --no-verify-jwt
supabase functions deploy generate-themes --no-verify-jwt
```

Both functions use `--no-verify-jwt` because they authenticate via the shared `WEBHOOK_SECRET` Bearer token rather than a Supabase JWT.

---

## 6. Cloudflare deployment (the SPA)

The frontend ships on **Cloudflare Workers Static Assets** (not the older Pages product). Config lives at `web/wrangler.jsonc` — kept inside `web/` so Cloudflare's build worker sees it when it `cd`s into that subdirectory.

### How the deploy works

1. Cloudflare's Git integration is pointed at this repo's `main` branch.
2. Build settings in the Workers dashboard:
   - **Root directory**: `web`
   - **Build command**: `npm run build` (runs `tsc -b && vite build`)
   - **Build output directory**: `dist`
3. On push to `main`, Cloudflare runs the build and uploads `web/dist/`.
4. `wrangler.jsonc` → `assets.not_found_handling: "single-page-application"` rewrites deep-link 404s back to `index.html` so React Router handles client-side routing.

### Build-time env vars — **set these in Cloudflare**, not just `.env.local`

Vite bakes every `VITE_*` variable into the bundle at **build time**. `.env.local` only affects `npm run dev` on your laptop; the deployed build won't see it. Set these as **Build variables** in the Workers dashboard → *Settings → Variables and Secrets → Build*:

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_COACH_AI_SECRET` | Same value as `WEBHOOK_SECRET` on the edge function |

> **Don't** add `ANTHROPIC_API_KEY` here. `VITE_*` vars ship to every visitor's browser — putting the Anthropic key there would expose it to anyone who opens devtools.

### Manual deploy (optional)

If you'd rather push from your laptop instead of the Git integration:

```bash
cd web
npx wrangler deploy
```

You'll need to set the same build vars locally (e.g. in `web/.env.local`) so `vite build` can pick them up before wrangler uploads. The Git integration is the recommended path — it re-runs builds on every main push so env changes don't go out of sync.

### Re-deploying after a secret rotation

If you rotate `VITE_COACH_AI_SECRET` (client) / `WEBHOOK_SECRET` (edge function), you must:

1. Update the value in **both** places (Cloudflare Build variables AND `supabase secrets set WEBHOOK_SECRET=...`).
2. **Trigger a new Cloudflare build** — update a Build variable, or push an empty commit. Without a fresh build the browser bundle still ships the old value and your "Generate" button will 401.

---

## 7. Smoke tests

A standalone script validates that everything is wired up correctly — useful after a fresh deploy or when onboarding a new machine.

```bash
# Config-only (env, table exists, function reachable, auth enforced)
node scripts/test-coaching-themes.mjs

# Full end-to-end (actually calls Claude — costs ~$0.01)
node scripts/test-coaching-themes.mjs <sessionId> <playerId>
```

Expected output on success: `10 passed, 0 failed`.

Need to figure out which Claude models your API key can access?

```bash
ANTHROPIC_API_KEY=sk-ant-api03-... node scripts/probe-anthropic-models.mjs
```

---

## 8. Running the app

### Dev server

```bash
cd web
npm run dev
# http://localhost:5173
```

### Bulk import PB Vision games

```bash
# Scrape video IDs from pb.vision, then:
node scripts/sync-pbvision.mjs --ids-file data/pbvision/video-ids.txt

# Import already-downloaded JSON files:
node scripts/sync-pbvision.mjs --import-only
```

### Test the PB Vision webhook

```bash
curl -X POST https://<your-project>.supabase.co/functions/v1/pbvision-webhook \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"videoId":"<pbv-id>","muxPlaybackId":"<mux-id>"}'
```

---

## 9. Key routes

| Route | Who | What |
|---|---|---|
| `/org/:orgId` | Anyone | Player leaderboard |
| `/org/:orgId/sessions/:sessionId` | Anyone | Session detail |
| `/org/:orgId/sessions/:sessionId/report` | Anyone | Printable session report (rollup + common themes) |
| `/org/:orgId/games/:gameId` | Anyone | Game stats |
| `/org/:orgId/games/:gameId/report` | Anyone | Printable game report |
| `/org/:orgId/games/:gameId/analyze` | Coach | Video analysis, flags, sequences |
| `/org/:orgId/games/:gameId/coach-review` | Coach | Review queue walkthrough |
| `/org/:orgId/games/:gameId/present?share=1` | Anyone (if `is_public`) | Full-screen presentation deck |

---

## 10. Common issues

### `Could not find the table 'public.player_coaching_themes'`
Migration 019 hasn't been applied. Run `supabase db push`.

### `anthropic failed: 401 invalid x-api-key`
Run `supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...` with a valid key from console.anthropic.com, then re-test.

### `anthropic failed: 404 not_found_error model: ...`
The model ID isn't available on this Anthropic account. Run `scripts/probe-anthropic-models.mjs` with your key to see what's provisioned, then `supabase secrets set THEMES_MODEL=<id-from-list>`.

### `AI themes are disabled — set VITE_COACH_AI_SECRET`
Missing or empty in `web/.env.local`. Add it and restart `npm run dev`.

### Edge function returns 404
It's not deployed. Run `supabase functions deploy <name> --no-verify-jwt`.

### Edge function returns 401 with a valid-looking Bearer token
The function's `WEBHOOK_SECRET` doesn't match `VITE_COACH_AI_SECRET` on the client. Reconcile them — usually easiest to re-set both to the same fresh random string.

---

## 11. Documentation conventions

- `CLAUDE.md` — architecture, decisions, PB Vision integration details (for humans + Claude agents).
- `docs/DESIGN_PREFERENCES.md` — UI conventions (destructive confirms, status dots, tone chips, etc.).
- `README.md` — this file; getting-started + troubleshooting.

When you add a feature that requires setup (a new migration, a new secret, a new edge function), add it to this README under §4 / §5 / §6 so the next person bringing up an instance doesn't have to reverse-engineer the config from source.
