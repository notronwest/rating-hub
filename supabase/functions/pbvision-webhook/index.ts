import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INSIGHTS_API = "https://api-2o2klzx4pa-uc.a.run.app/video";
const MAX_SESSIONS = 10;
const ORG_SLUG = Deno.env.get("ORG_SLUG") || "wmppc";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";

// ---------------------------------------------------------------------------
// Supabase client (service role — full access)
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Enum decoders for compact shot format
const STROKE_SIDES = ["left", "right"] as const;
const STROKE_TYPES = ["backhand", "forehand", "two-handed"] as const;
const VERTICAL_TYPES = ["neutral", "topspin", "slice", "dig", "lob"] as const;
const SHT_TYPES = [
  "drive", "dink", "drop", "lob", "smash", "volley", "reset", "speedup",
] as const;

// deno-lint-ignore no-explicit-any
function deriveShotType(shot: any, shotIndex: number): string {
  const tagKeys = Object.keys(shot.tag ?? {}).join(" ").toLowerCase();
  if (/type;serve/.test(tagKeys)) return "serve";
  if (shotIndex === 1) return "return";
  if (shot.spd) return "speedup";
  if (shot.res) return "reset";
  if (shot.put) return "putaway";
  if (shot.po) return "poach";
  if (shot.pass) return "passing";
  for (const label of ["drive", "dink", "drop", "lob", "smash"]) {
    if (new RegExp(`type;${label}\\b`).test(tagKeys)) return label;
  }
  if (shot.sht != null && SHT_TYPES[shot.sht]) return SHT_TYPES[shot.sht];
  if (shot.vol) return "volley";
  if (shotIndex === 2) return "third";
  return "shot";
}

function avatarUrl(
  bucket: string,
  videoId: string,
  aiEngineVersion: number,
  avatarId: number,
): string {
  return `https://storage.googleapis.com/${bucket}/${videoId}/${aiEngineVersion}/player${avatarId}-0.jpg`;
}

// ---------------------------------------------------------------------------
// Download insights from pb.vision public API (BOTH formats in parallel)
// ---------------------------------------------------------------------------

async function downloadInsights(
  videoId: string,
  sessionNum: number,
): Promise<{
  compact: Record<string, unknown> | null;
  augmented: Record<string, unknown> | null;
}> {
  const base = `${INSIGHTS_API}/${videoId}/insights.json?sessionNum=${sessionNum}`;
  const [cResp, aResp] = await Promise.all([
    fetch(`${base}&format=compact`),
    fetch(`${base}&format=augmented`),
  ]);
  return {
    compact: cResp.ok ? await cResp.json() : null,
    augmented: aResp.ok ? await aResp.json() : null,
  };
}

// ---------------------------------------------------------------------------
// Org + player resolution
// ---------------------------------------------------------------------------

async function resolveOrg(
  supabase: ReturnType<typeof createClient>,
  slug: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error(`Org "${slug}" not found`);
  return data.id;
}

async function findOrCreatePlayer(
  supabase: ReturnType<typeof createClient>,
  orgUuid: string,
  displayName: string,
  avatarUrlValue: string | null,
): Promise<string> {
  const playerSlug = slugify(displayName);
  if (!playerSlug) throw new Error(`Invalid player name: "${displayName}"`);

  let { data: existing } = await supabase
    .from("players")
    .select("id, avatar_url")
    .eq("org_id", orgUuid)
    .contains("pbvision_names", [displayName])
    .maybeSingle();

  if (!existing) {
    const { data: bySlug } = await supabase
      .from("players")
      .select("id, pbvision_names, avatar_url")
      .eq("org_id", orgUuid)
      .eq("slug", playerSlug)
      .maybeSingle();

    if (bySlug) {
      existing = bySlug;
      const names: string[] =
        (bySlug as { pbvision_names: string[] }).pbvision_names ?? [];
      if (!names.includes(displayName)) {
        await supabase
          .from("players")
          .update({ pbvision_names: [...names, displayName] })
          .eq("id", bySlug.id);
      }
    }
  }

  if (existing) {
    // Fill in avatar_url if missing and we have one
    if (avatarUrlValue && !(existing as { avatar_url: string | null }).avatar_url) {
      await supabase
        .from("players")
        .update({ avatar_url: avatarUrlValue })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: newPlayer, error } = await supabase
    .from("players")
    .insert({
      org_id: orgUuid,
      slug: playerSlug,
      display_name: displayName,
      pbvision_names: [displayName],
      avatar_url: avatarUrlValue,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create player "${displayName}": ${error.message}`);
  return newPlayer.id;
}

// ---------------------------------------------------------------------------
// Outcome parsing
// ---------------------------------------------------------------------------

interface ParsedOutcome {
  team0Score: number | null;
  team1Score: number | null;
  winningTeam: number | null;
}

function parseOutcome(gameOutcome?: (number | string)[]): ParsedOutcome {
  const outcome = gameOutcome ?? [];
  const team0Score = typeof outcome[0] === "number" ? outcome[0] : null;
  const team1Score = typeof outcome[1] === "number" ? outcome[1] : null;
  let winningTeam: number | null = null;
  if (team0Score != null && team1Score != null) {
    winningTeam = team0Score > team1Score ? 0 : team0Score < team1Score ? 1 : null;
  } else if (typeof outcome[0] === "string") {
    winningTeam = outcome[0] === "won" ? 0 : 1;
  }
  return { team0Score, team1Score, winningTeam };
}

// ---------------------------------------------------------------------------
// Import a single session (compact required, augmented optional)
// ---------------------------------------------------------------------------

interface ImportResult {
  gameId: string;
  playersProcessed: number;
  ralliesCreated: number;
  shotsCreated: number;
  augmentedMerged: boolean;
}

async function importSession(
  supabase: ReturnType<typeof createClient>,
  orgSlug: string,
  // deno-lint-ignore no-explicit-any
  compactJson: any,
  // deno-lint-ignore no-explicit-any
  augmentedJson: any | null,
  sessionId: string | null,
  muxPlaybackId: string | null,
): Promise<ImportResult> {
  const orgUuid = await resolveOrg(supabase, orgSlug);
  const data = compactJson.data?.ses ? compactJson.data : compactJson;
  const ses = data.ses;
  const gd = data.gd ?? {};
  const players = data.pd ?? [];
  const rallies = data.ral ?? [];
  const coaching = data.ca ?? [];
  const sm = data.sm ?? {};

  const { team0Score, team1Score, winningTeam } = parseOutcome(gd.game_outcome);

  const bucket = sm.bucket ?? "pbv-pro";
  const aiEngine = sm.aiEngineVersion ?? 0;

  // Upsert game (including mux_playback_id and highlights if augmented is present)
  const gameRow: Record<string, unknown> = {
    org_id: orgUuid,
    session_id: sessionId,
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
    ai_engine_version: aiEngine,
    pbvision_bucket: bucket,
    raw_game_data: gd,
  };
  if (muxPlaybackId) gameRow.mux_playback_id = muxPlaybackId;
  if (augmentedJson?.highlights) gameRow.highlights = augmentedJson.highlights;

  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .upsert(gameRow, { onConflict: "org_id,pbvision_video_id,session_index" })
    .select("id")
    .single();

  if (gameErr) throw new Error(`Failed to upsert game: ${gameErr.message}`);
  const gameId: string = gameData.id;

  // Augmented per-player advanced stats (119-key flat map; each key is array of 4)
  const advancedStats: Record<string, unknown> =
    (augmentedJson?.stats as Record<string, unknown>) ?? {};

  let playersProcessed = 0;
  const playerIds: (string | null)[] = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || !p.name) {
      playerIds.push(null);
      continue;
    }

    const displayName = p.name.trim();
    const avatar = p.avatar_id != null && aiEngine
      ? avatarUrl(bucket, ses.vid, aiEngine, p.avatar_id)
      : null;

    const playerId = await findOrCreatePlayer(supabase, orgUuid, displayName, avatar);
    playerIds.push(playerId);

    const trends = p.trends ?? {};
    const ratings = trends.ratings ?? {};
    const won = winningTeam != null ? p.team === winningTeam : null;

    // Build per-player advanced stats from augmented's flat 119-key stats map
    const playerAdvStats: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(advancedStats)) {
      if (Array.isArray(val) && val.length >= i + 1) {
        playerAdvStats[key] = val[i];
      }
    }

    const gpRow: Record<string, unknown> = {
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
    if (augmentedJson) {
      gpRow.advanced_stats = playerAdvStats;
      gpRow.highlights = augmentedJson.highlights ?? null;
    }

    await supabase
      .from("game_players")
      .delete()
      .eq("game_id", gameId)
      .eq("player_index", i);

    const { error: gpErr } = await supabase.from("game_players").insert(gpRow);
    if (gpErr) throw new Error(`Failed to insert game_player: ${gpErr.message}`);

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

  // Insert rallies — ON DELETE CASCADE removes old rally_shots automatically
  await supabase.from("rallies").delete().eq("game_id", gameId);

  const rallyRows = rallies.map((r: Record<string, unknown>, idx: number) => ({
    game_id: gameId,
    rally_index: idx,
    start_ms: r.sms,
    end_ms: r.ems,
    winning_team: r.wt ?? null,
    shot_count: Array.isArray(r.sh) ? r.sh.length : null,
    score_team0: (r.sc as Record<string, unknown>)?.rs
      ? ((r.sc as Record<string, unknown>).rs as number[])?.[0] ?? null
      : null,
    score_team1: (r.sc as Record<string, unknown>)?.rs
      ? ((r.sc as Record<string, unknown>).rs as number[])?.[1] ?? null
      : null,
    server_number: (r.sc as Record<string, unknown>)?.lb ?? null,
    player_positions: r.pls ?? null,
  }));

  const rallyIdByIndex = new Map<number, string>();
  for (let i = 0; i < rallyRows.length; i += 100) {
    const chunk = rallyRows.slice(i, i + 100);
    const { data: inserted, error: rallyErr } = await supabase
      .from("rallies")
      .insert(chunk)
      .select("id, rally_index");
    if (rallyErr) throw new Error(`Failed to insert rallies: ${rallyErr.message}`);
    for (const row of inserted ?? []) rallyIdByIndex.set(row.rally_index, row.id);
  }

  // Insert shots
  const shotRows: Array<Record<string, unknown>> = [];
  for (let rIdx = 0; rIdx < rallies.length; rIdx++) {
    const r = rallies[rIdx] as Record<string, unknown>;
    const rallyId = rallyIdByIndex.get(rIdx);
    if (!rallyId || !Array.isArray(r.sh)) continue;

    for (let sIdx = 0; sIdx < r.sh.length; sIdx++) {
      // deno-lint-ignore no-explicit-any
      const shot: any = r.sh[sIdx];
      const startMs = Array.isArray(shot?.t) ? shot.t[0] : r.sms;
      const endMs = Array.isArray(shot?.t) ? shot.t[1] : r.ems;
      shotRows.push({
        rally_id: rallyId,
        shot_index: sIdx,
        start_ms: startMs,
        end_ms: endMs,
        player_index: shot?.pid ?? null,
        shot_type: deriveShotType(shot, sIdx),
        stroke_type: shot?.st != null ? STROKE_TYPES[shot.st] ?? null : null,
        stroke_side: shot?.ss != null ? STROKE_SIDES[shot.ss] ?? null : null,
        vertical_type: shot?.vt != null ? VERTICAL_TYPES[shot.vt] ?? null : null,
        quality: shot?.q?.ex ?? shot?.q?.overall ?? null,
        is_final: !!shot?.fin,
        raw_data: shot,
      });
    }
  }

  if (shotRows.length > 0) {
    for (let i = 0; i < shotRows.length; i += 200) {
      const chunk = shotRows.slice(i, i + 200);
      const { error: shotErr } = await supabase.from("rally_shots").insert(chunk);
      if (shotErr) throw new Error(`Failed to insert rally_shots: ${shotErr.message}`);
    }
  }

  // Refresh aggregates
  for (const pid of playerIds) {
    if (!pid) continue;
    await supabase.rpc("refresh_player_aggregates", { p_player_id: pid });
  }

  return {
    gameId,
    playersProcessed,
    ralliesCreated: rallyRows.length,
    shotsCreated: shotRows.length,
    augmentedMerged: !!augmentedJson,
  };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify webhook secret if configured
  if (WEBHOOK_SECRET) {
    const auth = req.headers.get("Authorization");
    if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = getSupabase();
  let body: {
    videoId?: string;
    sessionId?: string;
    muxPlaybackId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { videoId, sessionId, muxPlaybackId } = body;

  if (!videoId) {
    return new Response(JSON.stringify({ error: "videoId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Log entry
  const { data: logEntry } = await supabase
    .from("webhook_logs")
    .insert({
      video_id: videoId,
      session_id: sessionId ?? null,
      status: "processing",
      payload: body,
    })
    .select("id")
    .single();
  const logId = logEntry?.id;

  try {
    const results: ImportResult[] = [];

    for (let sessionNum = 1; sessionNum <= MAX_SESSIONS; sessionNum++) {
      const { compact, augmented } = await downloadInsights(videoId, sessionNum);
      if (!compact) break;

      const result = await importSession(
        supabase,
        ORG_SLUG,
        compact,
        augmented,
        sessionId ?? null,
        muxPlaybackId ?? null,
      );
      results.push(result);
    }

    if (results.length === 0) {
      if (logId) {
        await supabase
          .from("webhook_logs")
          .update({
            status: "error",
            error_message: "No insights available — video may still be processing",
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }
      return new Response(
        JSON.stringify({
          status: "no_data",
          videoId,
          message: "No insights available. Video may still be processing (~30 min).",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    const totalPlayers = results.reduce((s, r) => s + r.playersProcessed, 0);
    const totalShots = results.reduce((s, r) => s + r.shotsCreated, 0);
    const anyAugmented = results.some((r) => r.augmentedMerged);

    if (logId) {
      await supabase
        .from("webhook_logs")
        .update({
          status: "success",
          sessions_found: results.length,
          games_imported: results.length,
          players_found: totalPlayers,
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }

    return new Response(
      JSON.stringify({
        status: "success",
        videoId,
        sessionsImported: results.length,
        augmentedMerged: anyAugmented,
        totalShots,
        muxPlaybackIdSet: !!muxPlaybackId,
        games: results.map((r) => ({
          gameId: r.gameId,
          players: r.playersProcessed,
          rallies: r.ralliesCreated,
          shots: r.shotsCreated,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      await supabase
        .from("webhook_logs")
        .update({
          status: "error",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }
    return new Response(
      JSON.stringify({ status: "error", videoId, error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
