import { supabase } from "../supabase";
import type {
  GameAnalysis,
  AnalysisNote,
  PlayerAssessment,
  AssessmentKind,
  NoteCategory,
  AnalysisSequence,
  FlaggedShot,
  CoachStatReview,
} from "../types/coach";

/**
 * Get or create a game analysis for this game. Requires the calling user
 * to be a coach in the game's org.
 */
export async function getOrCreateAnalysis(
  gameId: string,
  orgId: string,
  coachUserId: string,
): Promise<GameAnalysis> {
  // Try to get existing
  const { data: existing } = await supabase
    .from("game_analyses")
    .select("*")
    .eq("game_id", gameId)
    .maybeSingle();

  if (existing) return existing as GameAnalysis;

  // Create new
  const { data: created, error } = await supabase
    .from("game_analyses")
    .insert({
      game_id: gameId,
      org_id: orgId,
      coach_id: coachUserId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create analysis: ${error.message}`);
  return created as GameAnalysis;
}

export async function getAnalysisByGameId(
  gameId: string,
): Promise<GameAnalysis | null> {
  const { data } = await supabase
    .from("game_analyses")
    .select("*")
    .eq("game_id", gameId)
    .maybeSingle();
  return (data as GameAnalysis) ?? null;
}

export async function updateAnalysis(
  analysisId: string,
  patch: Partial<Pick<GameAnalysis, "video_url" | "overall_notes" | "overall_tone" | "is_public">>,
): Promise<void> {
  const { error } = await supabase
    .from("game_analyses")
    .update(patch)
    .eq("id", analysisId);
  if (error) throw new Error(error.message);
}

/**
 * Update the full set of dismissed loss keys on an analysis. Keys follow the
 * `loss:<rallyId>:<attributedShotId>` shape used by the Coach Review page.
 */
export async function setDismissedLossKeys(
  analysisId: string,
  keys: string[],
): Promise<void> {
  const { error } = await supabase
    .from("game_analyses")
    .update({ dismissed_loss_keys: keys })
    .eq("id", analysisId);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────────
// WMPC Analysis Topic recommendations
// ─────────────────────────────────────────────────────────────────

export interface TopicRecommendationRow {
  id: string;
  analysis_id: string;
  player_id: string;
  topic_id: string;
  recommendation: string | null;
  tags: string[];
  dismissed: boolean;
  fptm: unknown;            // FptmValue from lib/fptm — untyped at the DB edge
  drills: string | null;
  created_at: string;
  updated_at: string;
}

/** Load every recommendation belonging to one analysis. If `playerId` is
 *  provided, only that player's rows are returned; omit it to fetch all
 *  players for the analysis (used by the game report). */
export async function listTopicRecommendations(
  analysisId: string,
  playerId?: string,
): Promise<TopicRecommendationRow[]> {
  let q = supabase
    .from("analysis_topic_recommendations")
    .select("*")
    .eq("analysis_id", analysisId);
  if (playerId) q = q.eq("player_id", playerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as TopicRecommendationRow[];
}

/** Upsert a recommendation for (analysis, player, topic). */
export async function upsertTopicRecommendation(params: {
  analysisId: string;
  playerId: string;
  topicId: string;
  recommendation: string | null;
  tags: string[];
  dismissed: boolean;
  fptm?: unknown;
  drills?: string | null;
}): Promise<TopicRecommendationRow> {
  const { data, error } = await supabase
    .from("analysis_topic_recommendations")
    .upsert(
      {
        analysis_id: params.analysisId,
        player_id: params.playerId,
        topic_id: params.topicId,
        recommendation: params.recommendation,
        tags: params.tags,
        dismissed: params.dismissed,
        fptm: params.fptm ?? null,
        drills: params.drills ?? null,
      },
      { onConflict: "analysis_id,player_id,topic_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as TopicRecommendationRow;
}

// ─────────────────────────────────────────────────────────────────
// Stat Review entries — the "Stats to Review" panel on Coach Review.
// Just tracks which (analysis, player, stat_key) tuples a coach has
// added; the per-rally instances are computed live from existing data.
// ─────────────────────────────────────────────────────────────────

export async function listStatReviews(
  analysisId: string,
): Promise<CoachStatReview[]> {
  const { data, error } = await supabase
    .from("coach_stat_reviews")
    .select("*")
    .eq("analysis_id", analysisId);
  if (error) throw new Error(error.message);
  return (data ?? []) as CoachStatReview[];
}

export async function addStatReview(params: {
  analysisId: string;
  playerId: string;
  statKey: string;
}): Promise<CoachStatReview> {
  const { data, error } = await supabase
    .from("coach_stat_reviews")
    .upsert(
      {
        analysis_id: params.analysisId,
        player_id: params.playerId,
        stat_key: params.statKey,
      },
      { onConflict: "analysis_id,player_id,stat_key" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CoachStatReview;
}

export async function removeStatReview(params: {
  analysisId: string;
  playerId: string;
  statKey: string;
}): Promise<void> {
  const { error } = await supabase
    .from("coach_stat_reviews")
    .delete()
    .eq("analysis_id", params.analysisId)
    .eq("player_id", params.playerId)
    .eq("stat_key", params.statKey);
  if (error) throw new Error(error.message);
}

/** Save a Mux playback ID on the game row. */
export async function setGameMuxPlaybackId(
  gameId: string,
  playbackId: string,
): Promise<void> {
  const { error } = await supabase
    .from("games")
    .update({ mux_playback_id: playbackId })
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────

export async function listNotes(analysisId: string): Promise<AnalysisNote[]> {
  const { data, error } = await supabase
    .from("game_analysis_notes")
    .select("*")
    .eq("analysis_id", analysisId)
    .order("timestamp_ms", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AnalysisNote[];
}

export async function insertNote(params: {
  analysisId: string;
  playerId?: string | null;
  rallyId?: string | null;
  timestampMs?: number | null;
  category?: NoteCategory | null;
  note: string;
}): Promise<AnalysisNote> {
  const { data, error } = await supabase
    .from("game_analysis_notes")
    .insert({
      analysis_id: params.analysisId,
      player_id: params.playerId ?? null,
      rally_id: params.rallyId ?? null,
      timestamp_ms: params.timestampMs ?? null,
      category: params.category ?? null,
      note: params.note,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AnalysisNote;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<AnalysisNote, "note" | "category" | "player_id" | "timestamp_ms" | "rally_id">>,
): Promise<void> {
  const { error } = await supabase
    .from("game_analysis_notes")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase
    .from("game_analysis_notes")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────────
// Assessments
// ─────────────────────────────────────────────────────────────────

export async function listAssessments(
  analysisId: string,
): Promise<PlayerAssessment[]> {
  const { data, error } = await supabase
    .from("player_game_assessments")
    .select("*")
    .eq("analysis_id", analysisId);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlayerAssessment[];
}

export async function upsertAssessment(params: {
  analysisId: string;
  playerId: string;
  kind: AssessmentKind;
  tag: string;
  note?: string | null;
}): Promise<PlayerAssessment> {
  const { data, error } = await supabase
    .from("player_game_assessments")
    .upsert(
      {
        analysis_id: params.analysisId,
        player_id: params.playerId,
        kind: params.kind,
        tag: params.tag,
        note: params.note ?? null,
      },
      { onConflict: "analysis_id,player_id,kind,tag" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as PlayerAssessment;
}

export async function deleteAssessment(params: {
  analysisId: string;
  playerId: string;
  kind: AssessmentKind;
  tag: string;
}): Promise<void> {
  const { error } = await supabase
    .from("player_game_assessments")
    .delete()
    .eq("analysis_id", params.analysisId)
    .eq("player_id", params.playerId)
    .eq("kind", params.kind)
    .eq("tag", params.tag);
  if (error) throw new Error(error.message);
}

/**
 * Returns all assessments for a player across all games, joined with
 * analysis created_at for sorting and game_id for linking.
 */
export interface PlayerAssessmentHistoryRow {
  id: string;
  player_id: string;
  kind: AssessmentKind;
  tag: string;
  note: string | null;
  created_at: string;
  analysis_id: string;
  game_id: string;
  played_at: string | null;
}

export async function listPlayerAssessmentHistory(
  playerId: string,
): Promise<PlayerAssessmentHistoryRow[]> {
  const { data, error } = await supabase
    .from("player_game_assessments")
    .select(`
      id, player_id, kind, tag, note, created_at, analysis_id,
      game_analyses!inner ( game_id, games!inner ( played_at ) )
    `)
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<{
    id: string;
    player_id: string;
    kind: AssessmentKind;
    tag: string;
    note: string | null;
    created_at: string;
    analysis_id: string;
    game_analyses: { game_id: string; games: { played_at: string | null } };
  }>).map((r) => ({
    id: r.id,
    player_id: r.player_id,
    kind: r.kind,
    tag: r.tag,
    note: r.note,
    created_at: r.created_at,
    analysis_id: r.analysis_id,
    game_id: r.game_analyses.game_id,
    played_at: r.game_analyses.games?.played_at ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Sequences (chains of shots within a rally with teaching notes)
// ─────────────────────────────────────────────────────────────────

export async function listSequences(
  analysisId: string,
): Promise<AnalysisSequence[]> {
  const { data, error } = await supabase
    .from("game_analysis_sequences")
    .select("*")
    .eq("analysis_id", analysisId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AnalysisSequence[];
}

export async function createSequence(params: {
  analysisId: string;
  rallyId: string;
  shotIds: string[];
  label?: string | null;
  playerId?: string | null;
  playerIds?: string[];
  whatWentWrong?: string | null;
  howToFix?: string | null;
  fptm?: unknown;
  drills?: string | null;
}): Promise<AnalysisSequence> {
  const ids = params.playerIds ?? [];
  const { data, error } = await supabase
    .from("game_analysis_sequences")
    .insert({
      analysis_id: params.analysisId,
      rally_id: params.rallyId,
      shot_ids: params.shotIds,
      label: params.label ?? null,
      player_id: params.playerId ?? (ids.length === 1 ? ids[0] : null),
      player_ids: ids,
      what_went_wrong: params.whatWentWrong ?? null,
      how_to_fix: params.howToFix ?? null,
      fptm: params.fptm ?? null,
      drills: params.drills ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AnalysisSequence;
}

export async function updateSequence(
  id: string,
  patch: Partial<
    Pick<
      AnalysisSequence,
      "shot_ids" | "label" | "player_id" | "player_ids" | "what_went_wrong" | "how_to_fix" | "fptm" | "drills"
    >
  >,
): Promise<void> {
  const { error } = await supabase
    .from("game_analysis_sequences")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSequence(id: string): Promise<void> {
  const { error } = await supabase
    .from("game_analysis_sequences")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────────
// Flagged shots (coach bookmarks for later review)
// ─────────────────────────────────────────────────────────────────

export async function listFlaggedShots(
  analysisId: string,
): Promise<FlaggedShot[]> {
  const { data, error } = await supabase
    .from("analysis_flagged_shots")
    .select("*")
    .eq("analysis_id", analysisId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FlaggedShot[];
}

export async function flagShot(params: {
  analysisId: string;
  shotId: string;
  note?: string | null;
}): Promise<FlaggedShot> {
  const { data, error } = await supabase
    .from("analysis_flagged_shots")
    .upsert(
      {
        analysis_id: params.analysisId,
        shot_id: params.shotId,
        note: params.note ?? null,
      },
      { onConflict: "analysis_id,shot_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as FlaggedShot;
}

export async function unflagShot(
  analysisId: string,
  shotId: string,
): Promise<void> {
  const { error } = await supabase
    .from("analysis_flagged_shots")
    .delete()
    .eq("analysis_id", analysisId)
    .eq("shot_id", shotId);
  if (error) throw new Error(error.message);
}

/**
 * Promote a flagged shot into a sequence by grabbing a window of shots
 * around the flagged one (clamped to the rally). Copies over the flag's
 * fptm + drills so any diagnosis the coach already did survives.
 */
export async function promoteFlagToSequence(params: {
  flag: FlaggedShot;
  shots: Array<{ id: string; rally_id: string; shot_index: number; player_index: number | null }>;
  before: number;
  after: number;
  playerId?: string | null;
}): Promise<AnalysisSequence> {
  const { flag, shots, before, after } = params;
  const flagged = shots.find((s) => s.id === flag.shot_id);
  if (!flagged) throw new Error("Flagged shot not found in shots list");

  const rallyShots = shots
    .filter((s) => s.rally_id === flagged.rally_id)
    .sort((a, b) => a.shot_index - b.shot_index);

  const idx = rallyShots.findIndex((s) => s.id === flag.shot_id);
  const startIdx = Math.max(0, idx - before);
  const endIdx = Math.min(rallyShots.length - 1, idx + after);
  const shotIds = rallyShots.slice(startIdx, endIdx + 1).map((s) => s.id);

  return createSequence({
    analysisId: flag.analysis_id,
    rallyId: flagged.rally_id,
    shotIds,
    playerId: params.playerId ?? null,
    fptm: flag.fptm ?? undefined,
    drills: flag.drills ?? undefined,
  });
}

export async function updateFlagNote(id: string, note: string | null): Promise<void> {
  const { error } = await supabase
    .from("analysis_flagged_shots")
    .update({ note })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateFlagFptm(
  id: string,
  patch: { fptm?: unknown; drills?: string | null; note?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("analysis_flagged_shots")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─────────────────────────── Coaching themes (AI) ───────────────────────────

/** A single "common theme" row on a session × player. Persisted in
 *  `player_coaching_themes`. */
export interface CoachingTheme {
  id: string;
  org_id: string;
  player_id: string;
  session_id: string;
  title: string;
  problem: string;
  solution: string;
  order_idx: number;
  source: "ai" | "coach";
  edited: boolean;
  created_at: string;
  updated_at: string;
}

export async function listCoachingThemes(
  sessionId: string,
  playerId: string,
): Promise<CoachingTheme[]> {
  const { data, error } = await supabase
    .from("player_coaching_themes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("player_id", playerId)
    .order("order_idx");
  if (error) throw new Error(error.message);
  return (data ?? []) as CoachingTheme[];
}

export async function updateCoachingTheme(
  id: string,
  patch: Partial<Pick<CoachingTheme, "title" | "problem" | "solution" | "order_idx">>,
): Promise<void> {
  // Any coach edit flips the row to edited + source='coach' so the next
  // AI regenerate pass doesn't stomp it.
  const { error } = await supabase
    .from("player_coaching_themes")
    .update({ ...patch, edited: true, source: "coach" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCoachingTheme(id: string): Promise<void> {
  const { error } = await supabase
    .from("player_coaching_themes")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─────────────────────────── Rating-report emails ───────────────────────────

export interface RatingReportEmailRow {
  id: string;
  org_id: string;
  session_id: string;
  player_id: string;
  email_to: string;
  sent_by: string | null;
  resend_message_id: string | null;
  status: string;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  open_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
}

export async function listRatingReportEmails(
  sessionId: string,
): Promise<RatingReportEmailRow[]> {
  const { data, error } = await supabase
    .from("rating_report_emails")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RatingReportEmailRow[];
}

export async function sendRatingReports(args: {
  sessionId: string;
  playerIds?: string[];
  sentBy?: string;
}): Promise<{
  results: Array<{
    playerId: string;
    email: string | null;
    logId?: string;
    status: string;
    error?: string;
  }>;
}> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-rating-reports`;
  const secret = import.meta.env.VITE_COACH_AI_SECRET as string | undefined;
  if (!secret) {
    throw new Error(
      "Emails are disabled — set VITE_COACH_AI_SECRET in web/.env.local and RESEND_API_KEY on the edge function.",
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body;
}

/** Call the `generate-themes` edge function to (re)generate AI themes
 *  for a session × player. Requires `VITE_COACH_AI_SECRET` to be set in
 *  the client env and match the edge function's `WEBHOOK_SECRET`. */
export async function generateCoachingThemes(args: {
  sessionId: string;
  playerId: string;
  n?: number;
}): Promise<CoachingTheme[]> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-themes`;
  const secret = import.meta.env.VITE_COACH_AI_SECRET as string | undefined;
  if (!secret) {
    throw new Error(
      "AI themes are disabled — set VITE_COACH_AI_SECRET in web/.env.local and ANTHROPIC_API_KEY on the edge function.",
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body.themes as CoachingTheme[];
}
