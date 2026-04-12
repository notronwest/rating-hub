#!/usr/bin/env node
/**
 * sync-pbvision.mjs
 *
 * Downloads pb.vision compact insights JSON for every video ID provided,
 * saves them locally, and (optionally) imports them into Supabase.
 *
 * Usage:
 *   # Download + import all videos listed in a file (one video ID per line):
 *   node scripts/sync-pbvision.mjs --ids-file data/pbvision/video-ids.txt
 *
 *   # Download + import specific video IDs:
 *   node scripts/sync-pbvision.mjs --ids 73ien57m8ksw,3uqtfeimwght
 *
 *   # Dry run (download only, no Supabase import):
 *   node scripts/sync-pbvision.mjs --ids-file data/pbvision/video-ids.txt --dry-run
 *
 *   # Skip download, just import existing local files:
 *   node scripts/sync-pbvision.mjs --import-only
 *
 * Environment variables:
 *   SUPABASE_URL        - Supabase project URL
 *   SUPABASE_ANON_KEY   - Supabase anon key
 *   ORG_ID              - Organization slug (default: "wmppc")
 *   DATA_DIR             - Where to save JSON files (default: "data/pbvision")
 */

import fs from "node:fs";
import path from "node:path";

// Lazy-load supabase only when needed (not for --dry-run)
let createClient;
async function loadSupabase() {
  if (createClient) return;
  try {
    const mod = await import("@supabase/supabase-js");
    createClient = mod.createClient;
  } catch {
    // Try relative path to web/node_modules
    const mod = await import("../web/node_modules/@supabase/supabase-js/dist/module/index.js");
    createClient = mod.createClient;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INSIGHTS_API = "https://api-2o2klzx4pa-uc.a.run.app/video";
const ORG_ID = process.env.ORG_ID || "wmppc";
const DATA_DIR = process.env.DATA_DIR || path.resolve("data/pbvision");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

const hasFlag = (name) => args.includes(name);

const DRY_RUN = hasFlag("--dry-run");
const IMPORT_ONLY = hasFlag("--import-only");
const IDS_FILE = getArg("--ids-file");
const IDS_INLINE = getArg("--ids");
const MAX_SESSIONS = parseInt(getArg("--max-sessions") || "10", 10);

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

let supabase;

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Set them or use --dry-run.",
    );
    process.exit(1);
  }
  await loadSupabase();
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function log(msg) {
  console.log(`[sync] ${msg}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Download insights
// ---------------------------------------------------------------------------

async function downloadInsights(videoId, sessionNum = 1) {
  const url = `${INSIGHTS_API}/${videoId}/insights.json?sessionNum=${sessionNum}&format=compact`;
  const resp = await fetch(url);

  if (!resp.ok) return null; // 400/404 = no more sessions

  const json = await resp.json();

  // Validate it has the expected compact format
  const data = json.data?.ses ? json.data : json;
  if (!data.ses && !data.ral) {
    log(`  Unexpected format for ${videoId} session ${sessionNum}`);
    return null;
  }

  return json;
}

async function downloadAllSessions(videoId) {
  const results = [];

  for (let sessionNum = 1; sessionNum <= MAX_SESSIONS; sessionNum++) {
    const json = await downloadInsights(videoId, sessionNum);
    if (!json) break; // No more sessions

    const filename = `${videoId}-s${sessionNum}.json`;
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(json, null, 2));
    log(`  Saved ${filename}`);
    results.push({ videoId, sessionNum, filepath, json });

    // Small delay between requests
    await sleep(200);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Import into Supabase (mirrors web/src/lib/importPbVision.ts logic)
// ---------------------------------------------------------------------------

async function resolveOrg(orgSlug) {
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  if (error || !data)
    throw new Error(`Organization "${orgSlug}" not found. Create it first.`);
  return data.id;
}

async function findOrCreatePlayer(orgUuid, displayName) {
  const playerSlug = slugify(displayName);
  if (!playerSlug) throw new Error(`Invalid player name: "${displayName}"`);

  // Find by pbvision_names
  let { data: existing } = await supabase
    .from("players")
    .select("id")
    .eq("org_id", orgUuid)
    .contains("pbvision_names", [displayName])
    .maybeSingle();

  if (!existing) {
    const { data: bySlug } = await supabase
      .from("players")
      .select("id, pbvision_names")
      .eq("org_id", orgUuid)
      .eq("slug", playerSlug)
      .maybeSingle();

    if (bySlug) {
      existing = bySlug;
      const names = bySlug.pbvision_names ?? [];
      if (!names.includes(displayName)) {
        await supabase
          .from("players")
          .update({ pbvision_names: [...names, displayName] })
          .eq("id", bySlug.id);
      }
    }
  }

  if (existing) return existing.id;

  const { data: newPlayer, error } = await supabase
    .from("players")
    .insert({
      org_id: orgUuid,
      slug: playerSlug,
      display_name: displayName,
      pbvision_names: [displayName],
    })
    .select("id")
    .single();

  if (error)
    throw new Error(`Failed to create player "${displayName}": ${error.message}`);
  log(`  Created player: ${displayName}`);
  return newPlayer.id;
}

function parseOutcome(gameOutcome) {
  const outcome = gameOutcome ?? [];
  const team0Score = typeof outcome[0] === "number" ? outcome[0] : null;
  const team1Score = typeof outcome[1] === "number" ? outcome[1] : null;
  let winningTeam = null;
  if (team0Score != null && team1Score != null) {
    winningTeam =
      team0Score > team1Score ? 0 : team0Score < team1Score ? 1 : null;
  } else if (typeof outcome[0] === "string") {
    winningTeam = outcome[0] === "won" ? 0 : 1;
  }
  return { team0Score, team1Score, winningTeam };
}

async function importCompactJson(orgSlug, json, filename) {
  const orgUuid = await resolveOrg(orgSlug);
  const data = json.data?.ses ? json.data : json;
  const ses = data.ses;
  const gd = data.gd ?? {};
  const players = data.pd ?? [];
  const rallies = data.ral ?? [];
  const coaching = data.ca ?? [];
  const sm = data.sm ?? {};

  const { team0Score, team1Score, winningTeam } = parseOutcome(gd.game_outcome);

  const gameRow = {
    org_id: orgUuid,
    pbvision_video_id: ses.vid,
    session_index: ses.si ?? 0,
    session_name: ses.name ?? null,
    played_at: ses.ge ? new Date(ses.ge * 1000).toISOString() : null,
    session_type: ses.st ?? 0,
    num_players: ses.np ?? 4,
    scoring_type: gd.scoring ?? null,
    min_points: gd.min_points ?? null,
    team0_score: team0Score,
    team1_score: team1Score,
    winning_team: winningTeam,
    avg_shots_per_rally: gd.avg_shots ?? null,
    total_rallies: rallies.length || null,
    kitchen_rallies: gd.kitchen_rallies ?? null,
    longest_rally_shots: gd.longest_rally?.num_shots ?? null,
    team0_kitchen_pct: gd.team_percentage_to_kitchen?.[0] ?? null,
    team1_kitchen_pct: gd.team_percentage_to_kitchen?.[1] ?? null,
    ai_engine_version: sm.aiEngineVersion ?? null,
    pbvision_bucket: sm.bucket ?? null,
    raw_game_data: gd,
  };

  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .upsert(gameRow, { onConflict: "org_id,pbvision_video_id,session_index" })
    .select("id")
    .single();

  if (gameErr) throw new Error(`Failed to upsert game: ${gameErr.message}`);
  const gameId = gameData.id;

  let playersProcessed = 0;
  const playerIds = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || !p.name) {
      playerIds.push(null);
      continue;
    }

    const displayName = p.name.trim();
    const playerId = await findOrCreatePlayer(orgUuid, displayName);
    playerIds.push(playerId);

    const trends = p.trends ?? {};
    const ratings = trends.ratings ?? {};
    const won = winningTeam != null ? p.team === winningTeam : null;

    const gpRow = {
      game_id: gameId,
      player_id: playerId,
      org_id: orgUuid,
      player_index: i,
      team: p.team ?? 0,
      won,
      shot_count: p.shot_count ?? null,
      left_side_percentage: p.left_side_percentage ?? null,
      total_team_shot_pct: p.total_team_shot_percentage ?? null,
      distance_covered: p.court_coverage?.total_distance_covered ?? null,
      x_coverage_pct: p.court_coverage?.average_x_coverage_percentage ?? null,
      rating_overall: ratings.overall ?? null,
      rating_serve: ratings.serve ?? null,
      rating_return: ratings.return ?? null,
      rating_offense: ratings.offense ?? null,
      rating_defense: ratings.defense ?? null,
      rating_agility: ratings.agility ?? null,
      rating_consistency: ratings.consistency ?? null,
      num_rallies: trends.num_rallies ?? null,
      num_rallies_won: trends.num_rallies_won ?? null,
      kitchen_arrival_pct: p.kitchen_arrival_percentage ?? null,
      kitchen_arrivals_summary: trends.kitchen_arrivals ?? null,
      role_data: p.role_data ?? null,
      serve_depth: trends.serve_depth ?? null,
      return_depth: trends.return_depth ?? null,
      serve_speed_dist: trends.serve_speed ?? null,
      shot_quality: trends.shot_quality ?? null,
      shot_selection: trends.shot_selection ?? null,
      shot_accuracy: trends.shot_accuracy ?? null,
      coaching_advice: coaching[i]?.advice ?? null,
      raw_player_data: p,
    };

    await supabase
      .from("game_players")
      .delete()
      .eq("game_id", gameId)
      .eq("player_index", i);

    const { error: gpErr } = await supabase.from("game_players").insert(gpRow);
    if (gpErr)
      throw new Error(`Failed to insert game_player: ${gpErr.message}`);

    // Rating snapshot
    const playedAt = ses.ge
      ? new Date(ses.ge * 1000).toISOString()
      : new Date().toISOString();
    const teamScore = p.team === 0 ? team0Score : team1Score;
    const opponentScore = p.team === 0 ? team1Score : team0Score;

    await supabase.from("player_rating_snapshots").upsert(
      {
        player_id: playerId,
        game_id: gameId,
        org_id: orgUuid,
        played_at: playedAt,
        rating_overall: ratings.overall ?? null,
        rating_serve: ratings.serve ?? null,
        rating_return: ratings.return ?? null,
        rating_offense: ratings.offense ?? null,
        rating_defense: ratings.defense ?? null,
        rating_agility: ratings.agility ?? null,
        rating_consistency: ratings.consistency ?? null,
        won,
        team_score: teamScore,
        opponent_score: opponentScore,
      },
      { onConflict: "player_id,game_id" },
    );

    playersProcessed++;
  }

  // Insert rallies
  await supabase.from("rallies").delete().eq("game_id", gameId);

  const rallyRows = rallies.map((r, idx) => ({
    game_id: gameId,
    rally_index: idx,
    start_ms: r.sms,
    end_ms: r.ems,
    winning_team: r.wt ?? null,
    shot_count: r.sh?.length ?? null,
    score_team0: r.sc?.rs?.[0] ?? null,
    score_team1: r.sc?.rs?.[1] ?? null,
    server_number: r.sc?.lb ?? null,
    player_positions: r.pls ?? null,
  }));

  for (let i = 0; i < rallyRows.length; i += 100) {
    const chunk = rallyRows.slice(i, i + 100);
    const { error: rallyErr } = await supabase.from("rallies").insert(chunk);
    if (rallyErr)
      throw new Error(`Failed to insert rallies: ${rallyErr.message}`);
  }

  // Refresh aggregates
  for (const pid of playerIds) {
    if (!pid) continue;
    await supabase.rpc("refresh_player_aggregates", { p_player_id: pid });
  }

  return { gameId, playersProcessed, ralliesCreated: rallyRows.length };
}

// ---------------------------------------------------------------------------
// Check if already imported
// ---------------------------------------------------------------------------

async function isAlreadyImported(orgUuid, videoId, sessionIndex) {
  const { data } = await supabase
    .from("games")
    .select("id")
    .eq("org_id", orgUuid)
    .eq("pbvision_video_id", videoId)
    .eq("session_index", sessionIndex)
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Collect video IDs
  let videoIds = [];

  if (IMPORT_ONLY) {
    // Scan local directory for downloaded JSON files
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    log(`Found ${files.length} local JSON files to import.`);

    if (!DRY_RUN) await initSupabase();

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      const filepath = path.join(DATA_DIR, file);
      try {
        const json = JSON.parse(fs.readFileSync(filepath, "utf8"));
        const data = json.data?.ses ? json.data : json;
        if (!data.ses) {
          log(`  Skipping ${file} (not compact format)`);
          skipped++;
          continue;
        }

        if (DRY_RUN) {
          log(`  [dry-run] Would import ${file}: ${data.ses.vid} session ${data.ses.si}`);
          continue;
        }

        const result = await importCompactJson(ORG_ID, json, file);
        log(`  Imported ${file}: game ${result.gameId}, ${result.playersProcessed} players, ${result.ralliesCreated} rallies`);
        imported++;
      } catch (err) {
        log(`  ERROR importing ${file}: ${err.message}`);
        failed++;
      }
    }

    log(`\nImport complete: ${imported} imported, ${skipped} skipped, ${failed} failed.`);
    return;
  }

  if (IDS_FILE) {
    const content = fs.readFileSync(IDS_FILE, "utf8");
    videoIds = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } else if (IDS_INLINE) {
    videoIds = IDS_INLINE.split(",").map((s) => s.trim());
  } else {
    console.error(
      "Provide video IDs via --ids or --ids-file, or use --import-only.\n" +
        "See scripts/extract-pbvision-ids.js for extracting IDs from pb.vision.",
    );
    process.exit(1);
  }

  log(`Processing ${videoIds.length} video IDs...`);

  if (!DRY_RUN) await initSupabase();

  let orgUuid;
  if (!DRY_RUN) {
    orgUuid = await resolveOrg(ORG_ID);
  }

  const summary = { downloaded: 0, imported: 0, skipped: 0, failed: 0 };

  for (const videoId of videoIds) {
    log(`\nProcessing ${videoId}...`);

    // Download all sessions for this video
    const sessions = await downloadAllSessions(videoId);

    if (sessions.length === 0) {
      log(`  No insights available for ${videoId}`);
      summary.skipped++;
      continue;
    }

    summary.downloaded += sessions.length;

    if (DRY_RUN) {
      log(`  [dry-run] Downloaded ${sessions.length} session(s)`);
      continue;
    }

    // Import each session
    for (const { json, filepath, sessionNum } of sessions) {
      const data = json.data?.ses ? json.data : json;
      const sessionIndex = data.ses.si ?? 0;

      // Check if already imported
      const exists = await isAlreadyImported(orgUuid, videoId, sessionIndex);
      if (exists) {
        log(`  Session ${sessionNum} already imported, updating...`);
      }

      try {
        const result = await importCompactJson(ORG_ID, json, path.basename(filepath));
        log(`  Imported session ${sessionNum}: ${result.playersProcessed} players, ${result.ralliesCreated} rallies`);
        summary.imported++;
      } catch (err) {
        log(`  ERROR importing session ${sessionNum}: ${err.message}`);
        summary.failed++;
      }
    }
  }

  log(`\n===== SUMMARY =====`);
  log(`Videos processed: ${videoIds.length}`);
  log(`Sessions downloaded: ${summary.downloaded}`);
  log(`Sessions imported: ${summary.imported}`);
  log(`Skipped (no data): ${summary.skipped}`);
  log(`Failed: ${summary.failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
