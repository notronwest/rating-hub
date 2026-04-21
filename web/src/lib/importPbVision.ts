import { supabase } from "../supabase";

// ---------------------------------------------------------------------------
// Types for all PB Vision JSON formats
// ---------------------------------------------------------------------------

// -- Compact format types --

interface CompactSession {
  st: number;
  np: number;
  vid: string;
  si: number;
  name?: string;
  ge?: number;
}

interface CompactGameData {
  avg_shots?: number;
  game_outcome?: (number | string)[];
  scoring?: string;
  min_points?: number;
  kitchen_rallies?: number;
  team_percentage_to_kitchen?: number[];
  longest_rally?: { rally_idx: number; num_shots: number };
  relative_adjustments?: unknown;
}

interface CompactPlayerTrends {
  ratings?: {
    overall?: number;
    serve?: number;
    return?: number;
    offense?: number;
    defense?: number;
    agility?: number;
    consistency?: number;
  };
  serve_depth?: Record<string, number>;
  return_depth?: Record<string, number>;
  serve_speed?: number[];
  kitchen_arrivals?: { receiving_side?: number; serving_side?: number };
  shot_quality?: Record<string, number>;
  shot_selection?: Record<string, number>;
  shot_accuracy?: Record<string, number>;
  num_rallies?: number;
  num_rallies_won?: number;
  flags?: { won_game?: boolean };
}

interface CompactPlayerData {
  name?: string;
  avatar_id?: number;
  team?: number;
  shot_count?: number;
  left_side_percentage?: number;
  total_team_shot_percentage?: number;
  court_coverage?: {
    total_distance_covered?: number;
    average_x_coverage_percentage?: number;
  };
  kitchen_arrival_percentage?: unknown;
  role_data?: unknown;
  trends?: CompactPlayerTrends;
}

interface CompactShot {
  pid?: number;                    // player index (0-3)
  t?: [number, number];            // [start_ms, end_ms]
  ss?: number;                     // stroke side: 0=left, 1=right
  st?: number;                     // stroke type: 0=backhand, 1=forehand, 2=two-handed
  vt?: number;                     // vertical type: 0=neutral, 1=topspin, 2=slice, 3=dig, 4=lob
  sht?: number;                    // shot type (if present as int enum)
  q?: { ex?: number; overall?: number };
  tag?: Record<string, unknown>;   // tag paths like "type;serve;type;PUSH"
  fin?: number | boolean;          // is_final
  // boolean flags (present = true, absent = false)
  pass?: unknown;
  vol?: unknown;
  po?: unknown;
  res?: unknown;
  spd?: unknown;
  put?: unknown;
}

interface CompactRally {
  sms: number;
  ems: number;
  wt?: number;
  sh?: CompactShot[];
  sc?: {
    rs?: number[];
    lb?: number;
    lcs?: number;
  };
  pls?: unknown[];
}

// Enum decoders for compact shot format
const STROKE_SIDES = ["left", "right"] as const;
const STROKE_TYPES = ["backhand", "forehand", "two-handed"] as const;
const VERTICAL_TYPES = ["neutral", "topspin", "slice", "dig", "lob"] as const;
const SHT_TYPES = [
  "drive", "dink", "drop", "lob", "smash", "volley", "reset", "speedup",
] as const;

/**
 * Derive a readable shot_type label from a shot's tags + flags + sht enum.
 * Priority: explicit serve/return tag → sht enum → boolean flags → "shot".
 */
function deriveShotType(shot: CompactShot, shotIndex: number): string {
  const tagKeys = Object.keys(shot.tag ?? {}).join(" ").toLowerCase();

  // Check tag for serve / third / return / named types
  if (/type;serve/.test(tagKeys)) return "serve";
  if (shotIndex === 1) return "return";       // conventionally the 2nd shot
  if (shotIndex === 2) {
    // Third shot: drive/drop derived below
  }

  // Explicit boolean flags take precedence for special shots
  if (shot.spd) return "speedup";
  if (shot.res) return "reset";
  if (shot.put) return "putaway";
  if (shot.po) return "poach";
  if (shot.pass) return "passing";

  // Named type tag
  for (const label of ["drive", "dink", "drop", "lob", "smash"]) {
    if (new RegExp(`type;${label}\\b`).test(tagKeys)) return label;
  }

  // Integer enum if present
  if (shot.sht != null && SHT_TYPES[shot.sht]) {
    return SHT_TYPES[shot.sht];
  }

  if (shot.vol) return "volley";

  // Fallback by position
  if (shotIndex === 2) return "third";
  return "shot";
}

interface CompactCoachingAdvice {
  advice?: Array<{
    kind: string;
    relevance: number;
    value: number;
    ci?: [number, number];
    method?: string;
  }>;
}

interface CompactServerMeta {
  aiEngineVersion?: number;
  bucket?: string;
}

// -- Augmented insights format types --

interface AugmentedSession {
  session_type: string;
  num_players: number;
  vid: string;
  session_index: number;
}

interface AugmentedHighlight {
  rally_idx: number;
  shot_start_idx: number;
  shot_end_idx: number;
  rally_ending: boolean;
  s: number;
  e: number;
  kind: string;
  events: Array<{
    kind: string;
    shot_idx: number;
    score: number;
    ms: number;
    end_shot_idx?: number;
  }>;
  score: number;
  short_description: string;
}

// -- Stats format types --

interface StatsSession {
  session_type: string;
  num_players: number;
  vid: string;
  session_index: number;
}

interface ShotTypeBreakdown {
  count?: number;
  average_quality?: number;
  outcome_stats?: Record<string, number>;
  speed_stats?: Record<string, number>;
  average_baseline_distance?: number;
  median_baseline_distance?: number;
  average_height_above_net?: number;
  median_height_above_net?: number;
}

interface StatsPlayer {
  team: number;
  shot_count?: number;
  ball_directions?: Record<string, number>;
  volley_count?: number;
  ground_stroke_count?: number;
  final_shot_count?: number;
  net_impact_score?: number;
  net_fault_percentage?: number;
  out_fault_percentage?: number;
  average_shot_quality?: number;
  total_distance_covered?: number;
  average_x_coverage_percentage?: number;
  // Shot type breakdowns
  serves?: ShotTypeBreakdown;
  returns?: ShotTypeBreakdown;
  thirds?: ShotTypeBreakdown;
  fourths?: ShotTypeBreakdown;
  fifths?: ShotTypeBreakdown;
  drives?: ShotTypeBreakdown;
  drops?: ShotTypeBreakdown;
  dinks?: ShotTypeBreakdown;
  lobs?: ShotTypeBreakdown;
  smashes?: ShotTypeBreakdown;
  resets?: ShotTypeBreakdown;
  speedups?: ShotTypeBreakdown;
  forehands?: ShotTypeBreakdown;
  backhands?: ShotTypeBreakdown;
  third_drops?: ShotTypeBreakdown;
  third_drives?: ShotTypeBreakdown;
  third_lobs?: ShotTypeBreakdown;
  passing?: ShotTypeBreakdown;
  poaches?: ShotTypeBreakdown;
  // Court zone breakdowns
  kitchen_area?: ShotTypeBreakdown;
  mid_court_area?: ShotTypeBreakdown;
  near_baseline_area?: ShotTypeBreakdown;
  near_midline_area?: ShotTypeBreakdown;
  near_left_sideline_area?: ShotTypeBreakdown;
  near_right_sideline_area?: ShotTypeBreakdown;
  left_side_player?: ShotTypeBreakdown;
  right_side_player?: ShotTypeBreakdown;
  // Other fields we don't need to type strongly
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

type JsonFormat = "compact" | "augmented_insights" | "stats";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function detectFormat(json: any): JsonFormat {
  // Compact with data wrapper: { prompt, data: { ses, ... } }
  if (json.data?.ses || json.ses) return "compact";
  // Augmented insights: has version + session + player_data + highlights + stats
  if (json.version && json.session && json.player_data && json.highlights)
    return "augmented_insights";
  // Stats: has version + session + game + players
  if (json.version && json.session && json.game && json.players) return "stats";
  // Fallback: try compact
  if (json.ses || json.gd || json.pd) return "compact";
  throw new Error(
    `Unrecognized JSON format. Top-level keys: ${Object.keys(json).join(", ")}`,
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

export type ImportProgress = (message: string) => void;

interface ImportResult {
  gamesCreated: number;
  playersProcessed: number;
  ralliesCreated: number;
  format: JsonFormat;
}

async function resolveOrg(orgId: string): Promise<string> {
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgId)
    .single();
  if (error || !org)
    throw new Error(`Organization "${orgId}" not found. Create it first.`);
  return org.id;
}

async function findOrCreatePlayer(
  orgUuid: string,
  displayName: string,
  onProgress: ImportProgress,
  filename: string,
  avatarUrlValue: string | null = null,
): Promise<string> {
  const playerSlug = slugify(displayName);
  if (!playerSlug) throw new Error(`Invalid player name: "${displayName}"`);

  // Find by pbvision_names
  let { data: existing } = await supabase
    .from("players")
    .select("id, avatar_url")
    .eq("org_id", orgUuid)
    .contains("pbvision_names", [displayName])
    .maybeSingle();

  if (!existing) {
    // Try by slug
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

  if (error)
    throw new Error(`Failed to create player "${displayName}": ${error.message}`);
  onProgress(`[${filename}] Created player: ${displayName}`);
  return newPlayer.id;
}

async function findOrCreateSession(
  orgUuid: string,
  playedAt: string | null,
  playerIds: (string | null)[],
  playerNames: string[],
): Promise<string | null> {
  if (!playedAt) return null;
  const validIds = playerIds.filter((id): id is string => id != null);
  if (validIds.length === 0) return null;

  const playedDate = playedAt.slice(0, 10); // "YYYY-MM-DD"
  const playerGroupKey = [...validIds].sort().join(",");

  // Try to find existing session
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("org_id", orgUuid)
    .eq("played_date", playedDate)
    .eq("player_group_key", playerGroupKey)
    .maybeSingle();

  if (existing) return existing.id;

  // Generate label: "Ron-Steve-Mike-Jeff 2026-03-20"
  const firstNames = playerNames
    .map((n) => n.split(" ")[0])
    .sort();
  const label = `${firstNames.join("-")} ${playedDate}`;

  const { data: created, error } = await supabase
    .from("sessions")
    .insert({
      org_id: orgUuid,
      played_date: playedDate,
      player_group_key: playerGroupKey,
      label,
    })
    .select("id")
    .single();

  if (error) {
    // Might be a race condition — try to fetch again
    const { data: retry } = await supabase
      .from("sessions")
      .select("id")
      .eq("org_id", orgUuid)
      .eq("played_date", playedDate)
      .eq("player_group_key", playerGroupKey)
      .maybeSingle();
    return retry?.id ?? null;
  }

  return created.id;
}

async function resolveGame(
  orgUuid: string,
  videoId: string,
  sessionIndex: number,
): Promise<{ id: string; winning_team: number | null; team0_score: number | null; team1_score: number | null } | null> {
  const { data } = await supabase
    .from("games")
    .select("id, winning_team, team0_score, team1_score")
    .eq("org_id", orgUuid)
    .eq("pbvision_video_id", videoId)
    .eq("session_index", sessionIndex)
    .maybeSingle();
  return data;
}

async function resolveGamePlayerIds(
  gameId: string,
): Promise<Map<number, string>> {
  const { data } = await supabase
    .from("game_players")
    .select("player_id, player_index")
    .eq("game_id", gameId);
  const map = new Map<number, string>();
  if (data) {
    for (const row of data) {
      map.set(row.player_index, row.player_id);
    }
  }
  return map;
}

function parseOutcome(gameOutcome: (number | string)[] | undefined) {
  const outcome = gameOutcome ?? [];
  const team0Score = typeof outcome[0] === "number" ? outcome[0] : null;
  const team1Score = typeof outcome[1] === "number" ? outcome[1] : null;
  let winningTeam: number | null = null;
  if (team0Score != null && team1Score != null) {
    winningTeam =
      team0Score > team1Score ? 0 : team0Score < team1Score ? 1 : null;
  } else if (typeof outcome[0] === "string") {
    winningTeam = outcome[0] === "won" ? 0 : 1;
  }
  return { team0Score, team1Score, winningTeam };
}

// ---------------------------------------------------------------------------
// Shot type and court zone constants
// ---------------------------------------------------------------------------

const SHOT_TYPES = [
  "serves",
  "returns",
  "thirds",
  "fourths",
  "fifths",
  "drives",
  "drops",
  "dinks",
  "lobs",
  "smashes",
  "resets",
  "speedups",
  "forehands",
  "backhands",
  "third_drops",
  "third_drives",
  "third_lobs",
  "passing",
  "poaches",
] as const;

const COURT_ZONES = [
  "kitchen_area",
  "mid_court_area",
  "near_baseline_area",
  "near_midline_area",
  "near_left_sideline_area",
  "near_right_sideline_area",
  "left_side_player",
  "right_side_player",
] as const;

function buildBreakdownRow(
  gameId: string,
  playerId: string,
  key: string,
  breakdown: ShotTypeBreakdown | undefined,
) {
  if (!breakdown || breakdown.count == null) return null;
  return {
    game_id: gameId,
    player_id: playerId,
    shot_type: key,
    count: breakdown.count ?? null,
    average_quality: breakdown.average_quality ?? null,
    outcome_stats: breakdown.outcome_stats ?? null,
    speed_stats: breakdown.speed_stats ?? null,
    average_baseline_distance: breakdown.average_baseline_distance ?? null,
    median_baseline_distance: breakdown.median_baseline_distance ?? null,
    average_height_above_net: breakdown.average_height_above_net ?? null,
    median_height_above_net: breakdown.median_height_above_net ?? null,
  };
}

// ---------------------------------------------------------------------------
// Auto-detect and dispatch
// ---------------------------------------------------------------------------

export async function importJson(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any,
  filename: string,
  onProgress: ImportProgress,
  dryRun = false,
): Promise<ImportResult> {
  const format = detectFormat(json);
  onProgress(`[${filename}] Detected format: ${format}`);

  switch (format) {
    case "compact":
      return importCompactJson(orgId, json, filename, onProgress, dryRun);
    case "augmented_insights":
      return importAugmentedInsightsJson(
        orgId,
        json,
        filename,
        onProgress,
        dryRun,
      );
    case "stats":
      return importStatsJson(orgId, json, filename, onProgress, dryRun);
  }
}

// ---------------------------------------------------------------------------
// 1. Compact format importer (existing, unchanged)
// ---------------------------------------------------------------------------

export async function importCompactJson(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any,
  filename: string,
  onProgress: ImportProgress,
  dryRun = false,
): Promise<ImportResult> {
  const data = json.data?.ses ? json.data : json;
  const ses: CompactSession = data.ses;
  const gd: CompactGameData = data.gd ?? {};
  const players: (CompactPlayerData | null)[] = data.pd ?? [];
  const rallies: CompactRally[] = data.ral ?? [];
  const coaching: (CompactCoachingAdvice | null)[] = data.ca ?? [];
  const sm: CompactServerMeta = data.sm ?? {};

  const orgUuid = await resolveOrg(orgId);

  const { team0Score, team1Score, winningTeam } = parseOutcome(
    gd.game_outcome,
  );

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
    raw_game_data: gd as Record<string, unknown>,
  };

  onProgress(`[${filename}] Game: ${ses.vid} session ${ses.si}`);

  if (dryRun) {
    onProgress(`[${filename}] Dry run — skipping writes.`);
    return {
      gamesCreated: 0,
      playersProcessed: players.filter(Boolean).length,
      ralliesCreated: 0,
      format: "compact",
    };
  }

  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .upsert(gameRow, { onConflict: "org_id,pbvision_video_id,session_index" })
    .select("id")
    .single();

  if (gameErr) throw new Error(`Failed to upsert game: ${gameErr.message}`);
  const gameId: string = gameData.id;
  onProgress(`[${filename}] Game upserted: ${gameId}`);

  let playersProcessed = 0;
  const playerIds: (string | null)[] = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || !p.name) {
      playerIds.push(null);
      continue;
    }

    const displayName = p.name.trim();
    const avatar =
      p.avatar_id != null && sm.aiEngineVersion
        ? `https://storage.googleapis.com/${sm.bucket ?? "pbv-pro"}/${ses.vid}/${sm.aiEngineVersion}/player${p.avatar_id}-0.jpg`
        : null;
    const playerId = await findOrCreatePlayer(
      orgUuid,
      displayName,
      onProgress,
      filename,
      avatar,
    );
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
      raw_player_data: p as Record<string, unknown>,
    };

    await supabase
      .from("game_players")
      .delete()
      .eq("game_id", gameId)
      .eq("player_index", i);

    const { error: gpErr } = await supabase.from("game_players").insert(gpRow);
    if (gpErr)
      throw new Error(`Failed to insert game_player: ${gpErr.message}`);

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
    onProgress(
      `[${filename}] Player ${i}: ${displayName} (${won ? "W" : "L"})`,
    );
  }

  // Assign game to a session
  const playedAtIso = ses.ge ? new Date(ses.ge * 1000).toISOString() : null;
  const playerNamesList = (players ?? [])
    .filter((p): p is NonNullable<typeof p> => p != null && !!p.name)
    .map((p) => p.name!.trim());
  const sessionId = await findOrCreateSession(
    orgUuid,
    playedAtIso,
    playerIds,
    playerNamesList,
  );
  if (sessionId) {
    await supabase.from("games").update({ session_id: sessionId }).eq("id", gameId);
    onProgress(`[${filename}] Assigned to session ${sessionId}`);
  }

  // Insert rallies + shots
  // ON DELETE CASCADE on rally_shots.rally_id handles shot cleanup.
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

  // Insert in chunks and return ids so we can link shots
  const rallyIdByIndex = new Map<number, string>();
  for (let i = 0; i < rallyRows.length; i += 100) {
    const chunk = rallyRows.slice(i, i + 100);
    const { data: inserted, error: rallyErr } = await supabase
      .from("rallies")
      .insert(chunk)
      .select("id, rally_index");
    if (rallyErr)
      throw new Error(`Failed to insert rallies: ${rallyErr.message}`);
    for (const row of inserted ?? []) {
      rallyIdByIndex.set(row.rally_index, row.id);
    }
  }

  onProgress(`[${filename}] Inserted ${rallyRows.length} rallies.`);

  // Build and insert per-rally shots
  const shotRows: Array<Record<string, unknown>> = [];
  for (let rIdx = 0; rIdx < rallies.length; rIdx++) {
    const r = rallies[rIdx];
    const rallyId = rallyIdByIndex.get(rIdx);
    if (!rallyId || !r.sh) continue;

    for (let sIdx = 0; sIdx < r.sh.length; sIdx++) {
      const shot = r.sh[sIdx];
      const startMs = shot.t?.[0] ?? r.sms;
      const endMs = shot.t?.[1] ?? r.ems;
      shotRows.push({
        rally_id: rallyId,
        shot_index: sIdx,
        start_ms: startMs,
        end_ms: endMs,
        player_index: shot.pid ?? null,
        shot_type: deriveShotType(shot, sIdx),
        stroke_type: shot.st != null ? STROKE_TYPES[shot.st] ?? null : null,
        stroke_side: shot.ss != null ? STROKE_SIDES[shot.ss] ?? null : null,
        vertical_type: shot.vt != null ? VERTICAL_TYPES[shot.vt] ?? null : null,
        quality: shot.q?.ex ?? shot.q?.overall ?? null,
        is_final: !!shot.fin,
        raw_data: shot as Record<string, unknown>,
      });
    }
  }

  if (shotRows.length > 0) {
    for (let i = 0; i < shotRows.length; i += 200) {
      const chunk = shotRows.slice(i, i + 200);
      const { error: shotErr } = await supabase.from("rally_shots").insert(chunk);
      if (shotErr)
        throw new Error(`Failed to insert rally_shots: ${shotErr.message}`);
    }
    onProgress(`[${filename}] Inserted ${shotRows.length} shots.`);
  }

  // Refresh aggregates
  for (const pid of playerIds) {
    if (!pid) continue;
    const { error: rpcErr } = await supabase.rpc(
      "refresh_player_aggregates",
      { p_player_id: pid },
    );
    if (rpcErr) {
      onProgress(
        `[${filename}] Warning: failed to refresh aggregates: ${rpcErr.message}`,
      );
    }
  }

  onProgress(`[${filename}] Compact import complete.`);
  return {
    gamesCreated: 1,
    playersProcessed,
    ralliesCreated: rallyRows.length,
    format: "compact",
  };
}

// ---------------------------------------------------------------------------
// 2. Augmented insights importer
//    Enriches an existing game with highlights + advanced stats.
//    Game must already exist (import compact first).
// ---------------------------------------------------------------------------

async function importAugmentedInsightsJson(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any,
  filename: string,
  onProgress: ImportProgress,
  dryRun = false,
): Promise<ImportResult> {
  const session: AugmentedSession = json.session;
  const highlights: AugmentedHighlight[] = json.highlights ?? [];
  const advancedStats: Record<string, unknown> = json.stats ?? {};
  const playerData: Array<Record<string, unknown>> = json.player_data ?? [];
  const coachAdvice: Array<{ advice?: unknown[] }> = json.coach_advice ?? [];

  const orgUuid = await resolveOrg(orgId);
  const videoId = session.vid;
  const sessionIndex = session.session_index ?? 0;

  onProgress(`[${filename}] Insights for: ${videoId} session ${sessionIndex}`);

  if (dryRun) {
    onProgress(`[${filename}] Dry run — skipping writes.`);
    return { gamesCreated: 0, playersProcessed: playerData.length, ralliesCreated: 0, format: "augmented_insights" };
  }

  // Find existing game
  const game = await resolveGame(orgUuid, videoId, sessionIndex);
  if (!game) {
    throw new Error(
      `Game ${videoId} session ${sessionIndex} not found. Import the compact JSON first.`,
    );
  }

  // Update game with highlights
  if (highlights.length > 0) {
    await supabase
      .from("games")
      .update({ highlights })
      .eq("id", game.id);
    onProgress(`[${filename}] Added ${highlights.length} highlights to game.`);
  }

  // Get player index → player_id mapping
  const gpMap = await resolveGamePlayerIds(game.id);

  // Update each game_player with advanced_stats and highlights per player
  let playersProcessed = 0;
  for (let i = 0; i < playerData.length; i++) {
    const playerId = gpMap.get(i);
    if (!playerId) continue;

    // Build per-player advanced stats from the flat 119-key map
    // Each key maps to an array of 4 values (one per player index)
    const playerAdvStats: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(advancedStats)) {
      if (Array.isArray(val) && val.length >= i + 1) {
        playerAdvStats[key] = val[i];
      }
    }

    // Per-player highlights: filter to rallies where this player was involved
    // (we store all highlights on each player for simplicity — they're game-level)
    const updateData: Record<string, unknown> = {
      advanced_stats: playerAdvStats,
      highlights,
    };

    // Also update coaching advice if present and not already set
    if (coachAdvice[i]?.advice) {
      updateData.coaching_advice = coachAdvice[i].advice;
    }

    await supabase
      .from("game_players")
      .update(updateData)
      .eq("game_id", game.id)
      .eq("player_id", playerId);

    playersProcessed++;
  }

  onProgress(`[${filename}] Updated ${playersProcessed} players with advanced stats.`);

  // Extract per-shot geometry from augmented rallies into rally_shots rows.
  // This is where contact coordinates / trajectories / player positions live.
  const augmentedRallies: AugmentedRally[] = json.rallies ?? [];
  if (augmentedRallies.length > 0) {
    const shotsUpdated = await updatePerShotGeometry(
      game.id,
      augmentedRallies,
      onProgress,
      filename,
    );
    onProgress(`[${filename}] Updated geometry on ${shotsUpdated} shots.`);
  }

  // Refresh aggregates
  for (const playerId of gpMap.values()) {
    await supabase.rpc("refresh_player_aggregates", { p_player_id: playerId });
  }

  onProgress(`[${filename}] Augmented insights import complete.`);
  return { gamesCreated: 0, playersProcessed, ralliesCreated: 0, format: "augmented_insights" };
}

// -----------------------------------------------------------------------------
// Per-shot geometry extractor
// -----------------------------------------------------------------------------
// Pulls contact / landing / trajectory / speed / player positions from PB
// Vision's augmented `rallies[].shots[]` and writes them to existing
// rally_shots rows. Matches by (rally_index, shot_index) since those are
// stable across compact and augmented formats.

interface AugmentedTrajectoryPoint {
  ms?: number;
  location?: { x?: number; y?: number; z?: number };
  zone?: string;
}

interface AugmentedTrajectory {
  confidence?: number;
  start?: AugmentedTrajectoryPoint;
  peak?: { x?: number; y?: number; z?: number };
  end?: AugmentedTrajectoryPoint;
}

interface AugmentedBallMovement {
  angles?: { yaw?: number; pitch?: number; direction?: string };
  height_over_net?: number;
  speed?: number;
  distance?: number;
  crossed_net?: boolean;
  is_volleyed?: boolean;
  trajectory?: AugmentedTrajectory;
  distance_from_baseline?: number;
}

interface AugmentedShot {
  player_id?: number;
  resulting_ball_movement?: AugmentedBallMovement;
  is_final?: boolean;
  quality?: { overall?: number; execution?: number };
  stroke_side?: string;
  stroke_type?: string;
  vertical_type?: string;
  shot_type?: string;
  is_passing?: boolean;
  is_volley?: boolean;
  player_positions?: Array<{ x?: number; y?: number }>;
  advantage_scale?: number[];
  shooter_movement_from_last_shot?: { x?: number; y?: number };
  errors?: Record<string, unknown>;
  start_ms?: number;
  end_ms?: number;
  tags?: Record<string, unknown>;
}

interface AugmentedRally {
  start_ms?: number;
  end_ms?: number;
  shots?: AugmentedShot[];
  winning_team?: number;
}

async function updatePerShotGeometry(
  gameId: string,
  augRallies: AugmentedRally[],
  onProgress: ImportProgress,
  filename: string,
): Promise<number> {
  // Fetch all rallies for this game with their existing shots so we can map
  // augmented (rallyIdx, shotIdx) → rally_shots.id.
  const { data: rallies } = await supabase
    .from("rallies")
    .select("id, rally_index")
    .eq("game_id", gameId)
    .order("rally_index");
  if (!rallies || rallies.length === 0) return 0;

  const rallyIds = rallies.map((r) => r.id);
  const { data: shots } = await supabase
    .from("rally_shots")
    .select("id, rally_id, shot_index")
    .in("rally_id", rallyIds);
  if (!shots) return 0;

  // Build lookup: (rally_index, shot_index) → rally_shot.id
  const rallyIdxById = new Map(rallies.map((r) => [r.id, r.rally_index]));
  const shotIdByKey = new Map<string, string>();
  for (const s of shots) {
    const rIdx = rallyIdxById.get(s.rally_id);
    if (rIdx == null) continue;
    shotIdByKey.set(`${rIdx}:${s.shot_index}`, s.id);
  }

  // Update shots in chunks to avoid huge payloads.
  const CHUNK = 50;
  let updated = 0;
  for (let i = 0; i < augRallies.length; i++) {
    const rally = augRallies[i];
    const shots = rally.shots ?? [];
    for (let j = 0; j < shots.length; j++) {
      const shotId = shotIdByKey.get(`${i}:${j}`);
      if (!shotId) continue;
      const patch = buildShotPatch(shots[j]);
      if (!patch) continue;
      const { error } = await supabase
        .from("rally_shots")
        .update(patch)
        .eq("id", shotId);
      if (error) {
        onProgress(
          `[${filename}] Warn: shot ${i}.${j}: ${error.message}`,
        );
        continue;
      }
      updated++;
      if (updated % CHUNK === 0) {
        onProgress(`[${filename}] …${updated} shots updated so far`);
      }
    }
  }
  return updated;
}

function buildShotPatch(shot: AugmentedShot): Record<string, unknown> | null {
  const rbm = shot.resulting_ball_movement;
  const traj = rbm?.trajectory;
  const start = traj?.start?.location;
  const end = traj?.end?.location;

  // Promote the explicit shot_type if PBV provided one (compact import
  // derives it from tags; augmented is more authoritative).
  const patch: Record<string, unknown> = {};

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
// 3. Stats format importer
//    Enriches an existing game with shot type breakdowns, court zones,
//    ball directions, and extra aggregate stats.
//    Game must already exist (import compact first).
// ---------------------------------------------------------------------------

async function importStatsJson(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any,
  filename: string,
  onProgress: ImportProgress,
  dryRun = false,
): Promise<ImportResult> {
  const session: StatsSession = json.session;
  const statsPlayers: StatsPlayer[] = json.players ?? [];

  const orgUuid = await resolveOrg(orgId);
  const videoId = session.vid;
  const sessionIndex = session.session_index ?? 0;

  onProgress(`[${filename}] Stats for: ${videoId} session ${sessionIndex}`);

  if (dryRun) {
    onProgress(`[${filename}] Dry run — skipping writes.`);
    return { gamesCreated: 0, playersProcessed: statsPlayers.length, ralliesCreated: 0, format: "stats" };
  }

  // Find existing game
  const game = await resolveGame(orgUuid, videoId, sessionIndex);
  if (!game) {
    throw new Error(
      `Game ${videoId} session ${sessionIndex} not found. Import the compact JSON first.`,
    );
  }

  const gpMap = await resolveGamePlayerIds(game.id);

  let playersProcessed = 0;

  for (let i = 0; i < statsPlayers.length; i++) {
    const sp = statsPlayers[i];
    const playerId = gpMap.get(i);
    if (!playerId) continue;

    // Update game_players with extra stats columns
    await supabase
      .from("game_players")
      .update({
        ball_directions: sp.ball_directions ?? null,
        volley_count: sp.volley_count ?? null,
        ground_stroke_count: sp.ground_stroke_count ?? null,
        final_shot_count: sp.final_shot_count ?? null,
        net_impact_score: sp.net_impact_score ?? null,
        net_fault_percentage: sp.net_fault_percentage ?? null,
        out_fault_percentage: sp.out_fault_percentage ?? null,
      })
      .eq("game_id", game.id)
      .eq("player_id", playerId);

    // Insert shot type breakdowns
    await supabase
      .from("game_player_shot_types")
      .delete()
      .eq("game_id", game.id)
      .eq("player_id", playerId);

    const shotTypeRows = SHOT_TYPES.map((st) =>
      buildBreakdownRow(
        game.id,
        playerId,
        st,
        sp[st] as ShotTypeBreakdown | undefined,
      ),
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    if (shotTypeRows.length > 0) {
      const { error } = await supabase
        .from("game_player_shot_types")
        .insert(shotTypeRows);
      if (error)
        throw new Error(`Failed to insert shot types: ${error.message}`);
    }

    // Insert court zone breakdowns
    await supabase
      .from("game_player_court_zones")
      .delete()
      .eq("game_id", game.id)
      .eq("player_id", playerId);

    const courtZoneRows = COURT_ZONES.map((zone) => {
      const breakdown = sp[zone] as ShotTypeBreakdown | undefined;
      if (!breakdown || breakdown.count == null) return null;
      return {
        game_id: game.id,
        player_id: playerId,
        zone,
        count: breakdown.count ?? null,
        average_quality: breakdown.average_quality ?? null,
        outcome_stats: breakdown.outcome_stats ?? null,
        speed_stats: breakdown.speed_stats ?? null,
        average_baseline_distance: breakdown.average_baseline_distance ?? null,
        median_baseline_distance: breakdown.median_baseline_distance ?? null,
        average_height_above_net: breakdown.average_height_above_net ?? null,
        median_height_above_net: breakdown.median_height_above_net ?? null,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    if (courtZoneRows.length > 0) {
      const { error } = await supabase
        .from("game_player_court_zones")
        .insert(courtZoneRows);
      if (error)
        throw new Error(`Failed to insert court zones: ${error.message}`);
    }

    playersProcessed++;
    onProgress(
      `[${filename}] Player ${i}: ${shotTypeRows.length} shot types, ${courtZoneRows.length} court zones`,
    );
  }

  onProgress(`[${filename}] Stats import complete.`);
  return { gamesCreated: 0, playersProcessed, ralliesCreated: 0, format: "stats" };
}
