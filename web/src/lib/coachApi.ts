import { supabase } from "../supabase";
import type {
  GameAnalysis,
  AnalysisNote,
  PlayerAssessment,
  AssessmentKind,
  NoteCategory,
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
  patch: Partial<Pick<GameAnalysis, "video_url" | "overall_notes" | "is_public">>,
): Promise<void> {
  const { error } = await supabase
    .from("game_analyses")
    .update(patch)
    .eq("id", analysisId);
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
