#!/usr/bin/env node
/**
 * reimport-shot-geometry.mjs
 *
 * Walks every game in Supabase, downloads PB Vision's augmented insights
 * (public API, `format=augmented`), and back-fills the per-shot geometry
 * columns added in migration 015 — contact / landing coords, trajectory,
 * speed, height over net, direction, player positions, etc.
 *
 * This is the bulk companion to the in-browser augmented import. Run it
 * once after applying migration 015; afterward the webhook / manual imports
 * keep rows current.
 *
 * Usage:
 *   node scripts/reimport-shot-geometry.mjs                # all games
 *   node scripts/reimport-shot-geometry.mjs --video <id>   # single video id
 *   node scripts/reimport-shot-geometry.mjs --org <slug>   # filter to org
 *   node scripts/reimport-shot-geometry.mjs --dry-run      # fetch + log, no writes
 *
 * Env:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (preferred — bypasses RLS)
 *   SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY  (fallback — needs dev-mode RLS)
 */

import fs from "node:fs";
import path from "node:path";

// Lazy-load supabase client — mirrors sync-pbvision.mjs.
let createClient;
async function loadSupabase() {
  if (createClient) return;
  try {
    const mod = await import("@supabase/supabase-js");
    createClient = mod.createClient;
  } catch {
    // Fallback to web/ install — v2 of supabase-js ships `dist/index.mjs`.
    const mod = await import(
      "../web/node_modules/@supabase/supabase-js/dist/index.mjs"
    );
    createClient = mod.createClient;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Pull env from web/.env.local if the shell doesn't have them set — same
// convenience the other scripts in this repo lean on.
function loadDotenvLocal() {
  const p = path.resolve("web/.env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotenvLocal();

const INSIGHTS_API = "https://api-2o2klzx4pa-uc.a.run.app/video";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const getArg = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1] || null;
};

const DRY_RUN = hasFlag("--dry-run");
const ONLY_VIDEO = getArg("--video");
const ONLY_ORG = getArg("--org");

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_KEY. Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY.",
  );
  process.exit(1);
}

await loadSupabase();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[reimport] ${msg}`);
}

async function downloadAugmented(videoId, sessionNum) {
  const url = `${INSIGHTS_API}/${videoId}/insights.json?sessionNum=${sessionNum}&format=augmented`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/** Build an update patch for one augmented shot object. Mirrors
 *  buildShotPatch() in web/src/lib/importPbVision.ts. */
function buildShotPatch(shot) {
  const rbm = shot.resulting_ball_movement;
  const traj = rbm?.trajectory;
  const start = traj?.start?.location;
  const end = traj?.end?.location;
  const patch = {};

  if (start?.x != null) patch.contact_x = start.x;
  if (start?.y != null) patch.contact_y = start.y;
  if (start?.z != null) patch.contact_z = start.z;
  if (end?.x != null) patch.land_x = end.x;
  if (end?.y != null) patch.land_y = end.y;
  if (end?.z != null) patch.land_z = end.z;
  if (rbm?.speed != null) patch.speed_mph = rbm.speed;
  if (rbm?.height_over_net != null) patch.height_over_net = rbm.height_over_net;
  if (rbm?.distance != null) patch.distance_ft = rbm.distance;
  if (rbm?.distance_from_baseline != null) {
    patch.distance_from_baseline = rbm.distance_from_baseline;
  }
  if (rbm?.angles?.direction) patch.ball_direction = rbm.angles.direction;
  if (traj) patch.trajectory = traj;
  if (shot.player_positions) patch.player_positions = shot.player_positions;
  if (shot.advantage_scale) patch.advantage_scale = shot.advantage_scale;
  if (shot.errors && Object.keys(shot.errors).length > 0) {
    patch.shot_errors = shot.errors;
  }
  if (shot.shot_type) patch.shot_type = shot.shot_type;

  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------
// Per-game enrichment
// ---------------------------------------------------------------------------

async function enrichGame(game) {
  const videoId = game.pbvision_video_id;
  // compact format uses session_index = 0 by default, augmented accepts both.
  const sessionNum = 0;
  log(
    `-> ${game.id.slice(0, 8)}… video=${videoId} (${game.session_name ?? "unnamed"})`,
  );

  let aug;
  try {
    aug = await downloadAugmented(videoId, sessionNum);
  } catch (e) {
    log(`   skip: augmented fetch failed — ${e.message}`);
    return { updated: 0, skipped: true };
  }

  const augRallies = aug.rallies ?? [];
  if (augRallies.length === 0) {
    log("   skip: no rallies in augmented JSON");
    return { updated: 0, skipped: true };
  }

  // Fetch rally_shots for this game, indexed by (rally_index, shot_index).
  const { data: rallyRows, error: rErr } = await supabase
    .from("rallies")
    .select("id, rally_index")
    .eq("game_id", game.id)
    .order("rally_index");
  if (rErr || !rallyRows) {
    log(`   skip: rallies fetch failed — ${rErr?.message}`);
    return { updated: 0, skipped: true };
  }
  const rallyIdxById = new Map(rallyRows.map((r) => [r.id, r.rally_index]));

  const rallyIds = rallyRows.map((r) => r.id);
  const { data: shotRows, error: sErr } = await supabase
    .from("rally_shots")
    .select("id, rally_id, shot_index")
    .in("rally_id", rallyIds);
  if (sErr || !shotRows) {
    log(`   skip: shots fetch failed — ${sErr?.message}`);
    return { updated: 0, skipped: true };
  }

  const shotIdByKey = new Map();
  for (const s of shotRows) {
    const rIdx = rallyIdxById.get(s.rally_id);
    if (rIdx == null) continue;
    shotIdByKey.set(`${rIdx}:${s.shot_index}`, s.id);
  }

  let updated = 0;
  let missing = 0;
  for (let i = 0; i < augRallies.length; i++) {
    const shots = augRallies[i].shots ?? [];
    for (let j = 0; j < shots.length; j++) {
      const shotId = shotIdByKey.get(`${i}:${j}`);
      if (!shotId) {
        missing++;
        continue;
      }
      const patch = buildShotPatch(shots[j]);
      if (!patch) continue;
      if (DRY_RUN) {
        updated++;
        continue;
      }
      const { error } = await supabase
        .from("rally_shots")
        .update(patch)
        .eq("id", shotId);
      if (error) {
        log(`   shot ${i}.${j} update failed: ${error.message}`);
        continue;
      }
      updated++;
    }
  }
  log(
    `   ${DRY_RUN ? "(dry) would update" : "updated"} ${updated} shots` +
      (missing ? ` · ${missing} augmented shots had no matching row` : ""),
  );
  return { updated, skipped: false };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Build the game query
  let q = supabase
    .from("games")
    .select("id, org_id, pbvision_video_id, session_name, organizations!inner(slug)");
  if (ONLY_VIDEO) q = q.eq("pbvision_video_id", ONLY_VIDEO);
  if (ONLY_ORG) q = q.eq("organizations.slug", ONLY_ORG);

  const { data: games, error } = await q;
  if (error) {
    log(`Fatal: games query failed — ${error.message}`);
    process.exit(1);
  }

  log(
    `Found ${games.length} game(s)${DRY_RUN ? " (DRY RUN — no writes)" : ""}.`,
  );

  let totalUpdated = 0;
  let gamesProcessed = 0;
  let gamesSkipped = 0;

  for (const game of games) {
    if (!game.pbvision_video_id) {
      log(`Skip ${game.id.slice(0, 8)}: no pbvision_video_id`);
      gamesSkipped++;
      continue;
    }
    try {
      const { updated, skipped } = await enrichGame(game);
      if (skipped) gamesSkipped++;
      else {
        gamesProcessed++;
        totalUpdated += updated;
      }
      // Light courtesy pause — PBV's public API is generous but no need to hammer it.
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      log(`Game ${game.id.slice(0, 8)}: unexpected error — ${e.message}`);
      gamesSkipped++;
    }
  }

  log(
    `Done. Processed ${gamesProcessed} games, skipped ${gamesSkipped}, ${totalUpdated} shot rows updated.`,
  );
}

await main();
