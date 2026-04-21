# Deploying Rating Hub to Cloudflare Pages

This project deploys as a static SPA on **Cloudflare Pages**, connected
directly to the GitHub repo. Each push to `main` triggers a build and a
near-instant global rollout — no CI pipeline, no GitHub Actions needed.

The Supabase backend (DB + Edge Functions) stays where it is. Cloudflare Pages
only hosts the compiled frontend.

---

## Prerequisites

- The repo (`rating-hub` on GitHub) is pushed to `main` with the latest code.
- A Cloudflare account (free tier is plenty) with access to **Workers & Pages**.
- Your Supabase project URL and anon key (find them in Supabase → Project
  Settings → API). These already live in `web/.env.local` for local dev;
  you'll paste the same values into Cloudflare.

---

## One-time setup

### 1. Create a Pages project from GitHub

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) →
   **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**.
2. Authorize the Cloudflare GitHub App. When prompted for repo access, grant
   it either to the whole account or just the `rating-hub` repo.
3. Pick the **`rating-hub`** repo. Click **Begin setup**.

### 2. Configure the build

In the build settings page:

| Field | Value |
| --- | --- |
| **Project name** | `rating-hub` (or whatever subdomain you want — Cloudflare serves it at `https://<name>.pages.dev`) |
| **Production branch** | `main` |
| **Framework preset** | `Vite` (optional; it auto-fills the two fields below if you pick it) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `web` |

`Root directory = web` is the important one: the repo is a monorepo with the
SPA living under `web/`. Cloudflare runs `npm install` + `npm run build` from
that subdirectory and serves the `dist/` folder it produces.

### 3. Add environment variables

Still on the build settings page, under **Environment variables →
Production**, add:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://cjtfhegtgbfwccnruood.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | *(the anon key from Supabase; same one that's in `web/.env.local`)* |
| `NODE_VERSION` | `20` |

Pin `NODE_VERSION` explicitly — Cloudflare's default can lag behind Vite 7's
requirements, which causes mysterious install errors otherwise.

Repeat the three variables under **Preview** if you plan to preview PR builds.

### 4. Save and deploy

Hit **Save and Deploy**. Cloudflare clones the repo, runs your build, and
publishes to `https://rating-hub.pages.dev` (or whatever project name you
picked). First build usually takes 2–3 minutes.

---

## Subsequent deploys

Just push to `main`. Cloudflare watches the branch and rebuilds automatically.
Every push also gets a unique preview URL in the deploy log
(`<hash>.rating-hub.pages.dev`), useful for smoke-testing a build before it
replaces production.

### Rollback

Dashboard → your Pages project → **Deployments** tab → find a previous
successful deploy → **⋯** → **Rollback to this deployment**. Instant.

---

## Custom domain (optional)

When you want `ratinghub.wmpc.com` or similar:

1. Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter the domain. If the DNS is already on Cloudflare, it wires itself up
   in a click. If DNS is elsewhere, Cloudflare gives you a CNAME to add.
3. TLS is automatic.

---

## Alternative: deploying as a Worker (Workers Builds)

Cloudflare has been converging Pages and Workers. If the dashboard funnels
you into the Workers path (the setup form says "Configure your Worker
project" and asks for a **Deploy command** like `npx wrangler deploy`), you
have two choices:

1. **Back out and pick Pages** — on the Create screen, look for the Pages tab
   or "Import an existing Git repository" → Pages. The original instructions
   above apply unchanged.
2. **Stay on Workers** — the repo already includes `web/wrangler.jsonc` which
   configures a Workers Static Assets deployment with SPA fallback. Fill the
   form like this:

   | Field | Value |
   | --- | --- |
   | **Project name** | `rating-hub` |
   | **Build command** | `npm run build` |
   | **Deploy command** | `npx wrangler deploy` |
   | **Non-production branch deploy command** | `npx wrangler versions upload` |
   | **Path** | `web` ← NOT `/` |

   The **Path** field is the killer — it's the working directory, not a URL
   path. Set it to `web` so Cloudflare cds into the subdirectory where
   `package.json` and `wrangler.jsonc` live.

   Environment variables (Advanced settings → Variables and Secrets):

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `NODE_VERSION=20`

   **API token**: the form offers "Create new token" — let Cloudflare
   generate one with the default permissions it suggests for Workers Builds.
   That's the token wrangler uses to deploy on your behalf.

How this differs from Pages:

- SPA fallback is handled by `wrangler.jsonc`'s
  `assets.not_found_handling: "single-page-application"`, not by
  `public/_redirects` (which Workers ignores but is harmless to keep).
- Deploys are to `<project>.<account>.workers.dev` instead of `*.pages.dev`.
- Preview deploys use `wrangler versions upload` rather than the Pages
  branch-preview mechanic.

Either product is fine for this site — feature parity on static SPAs is
essentially complete now.

---

## What the repo provides for Cloudflare

These three pieces make Cloudflare Pages behave correctly for an SPA:

- **`web/vite.config.ts`** — builds into `web/dist/` by default so Cloudflare
  finds the output. (The old `../../www/ratinghub` path still works locally
  via `npm run build:local`, which is just `npm run build` with
  `BUILD_OUT_DIR` set.)
- **`web/public/_redirects`** — `/*  /index.html  200`. Without this, deep
  links like `/org/wmpc/games/123/analyze` 404 because Cloudflare doesn't
  know React Router owns them. Vite copies this file into `dist/` on build.
- **`web/public/_headers`** — aggressive caching for hashed `/assets/*`,
  no-cache for `/index.html`, so deploys take effect immediately for return
  visitors. (Workers ignores this file; Pages honors it.)
- **`web/wrangler.jsonc`** — used only when deploying via Workers (see the
  "Alternative" section). Declares `./dist` as the static assets directory
  and turns on SPA fallback.

You don't need to touch any of these — they're committed.

---

## Troubleshooting

**"`index.html` not found" on deploy.** The `Root directory` is wrong. It must
be `web`, not the repo root.

**Deep links return 404.** `_redirects` isn't being copied. Confirm the file
exists at `web/public/_redirects` and that the build log shows it being
emitted. A fresh `npm run build` locally should produce `dist/_redirects`.

**Supabase calls fail with "supabaseUrl is required".** The env vars aren't
set (or are set but named wrong — `VITE_` prefix is required so Vite embeds
them at build time).

**`Error: Cannot find module '…/package.json'`** in the build log. Usually a
Node version mismatch. Set `NODE_VERSION=20` as described above and redeploy.

**Build takes a long time.** First build installs all 800-odd modules; cached
subsequent builds finish in ~45s. If it's consistently slow, check whether
`package-lock.json` is committed (it should be) so Cloudflare can use
`npm ci`.

---

## Things that do NOT change when you deploy

- Supabase stays on Supabase. No migration.
- Edge functions (`supabase functions deploy …`) still deploy via the
  Supabase CLI from your laptop — Cloudflare Pages doesn't run them.
- The camera / session-manager workflow pushes to the same Supabase as
  before. It doesn't care where the frontend is hosted.
