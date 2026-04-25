// Types matching the PostgreSQL schema in db/migrations/001_initial_schema.sql

export interface Organization {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  org_id: string;
  slug: string;
  display_name: string;
  pbvision_names: string[];
  avatar_url: string | null;
  // Added in migration 006 — nullable; used for rating-report emails.
  email: string | null;
  is_active: boolean;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  org_id: string;
  pbvision_video_id: string;
  session_index: number;
  session_name: string | null;
  played_at: string | null;
  session_type: number;
  num_players: number;
  scoring_type: string | null;
  min_points: number | null;
  team0_score: number | null;
  team1_score: number | null;
  winning_team: number | null;
  avg_shots_per_rally: number | null;
  total_rallies: number | null;
  kitchen_rallies: number | null;
  longest_rally_shots: number | null;
  team0_kitchen_pct: number | null;
  team1_kitchen_pct: number | null;
  ai_engine_version: number | null;
  pbvision_bucket: string | null;
  raw_game_data: Record<string, unknown> | null;
  highlights: HighlightEvent[] | null;
  session_id: string | null;
  imported_at: string;
  created_at: string;
}

export interface Session {
  id: string;
  org_id: string;
  played_date: string;
  player_group_key: string;
  label: string | null;
  created_at: string;
}

export interface GamePlayer {
  id: string;
  game_id: string;
  player_id: string;
  org_id: string;
  player_index: number;
  team: number;
  won: boolean | null;
  shot_count: number | null;
  left_side_percentage: number | null;
  total_team_shot_pct: number | null;
  distance_covered: number | null;
  x_coverage_pct: number | null;
  rating_overall: number | null;
  rating_serve: number | null;
  rating_return: number | null;
  rating_offense: number | null;
  rating_defense: number | null;
  rating_agility: number | null;
  rating_consistency: number | null;
  num_rallies: number | null;
  num_rallies_won: number | null;
  kitchen_arrival_pct: KitchenArrivalPct | null;
  kitchen_arrivals_summary: KitchenArrivalsSummary | null;
  role_data: RoleData | null;
  serve_depth: DepthDistribution | null;
  return_depth: DepthDistribution | null;
  serve_speed_dist: number[] | null;
  shot_quality: ShotQualityDistribution | null;
  shot_selection: ShotSelectionDistribution | null;
  shot_accuracy: ShotAccuracyDistribution | null;
  coaching_advice: CoachingAdviceItem[] | null;
  raw_player_data: Record<string, unknown> | null;
  // Added in 002
  ball_directions: BallDirections | null;
  volley_count: number | null;
  ground_stroke_count: number | null;
  final_shot_count: number | null;
  net_impact_score: number | null;
  net_fault_percentage: number | null;
  out_fault_percentage: number | null;
  advanced_stats: Record<string, unknown> | null;
  highlights: HighlightEvent[] | null;
  created_at: string;
}

export interface Rally {
  id: string;
  game_id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  winning_team: number | null;
  shot_count: number | null;
  score_team0: number | null;
  score_team1: number | null;
  server_number: number | null;
  player_positions: Record<string, unknown> | null;
}

export interface RallyShot {
  id: string;
  rally_id: string;
  shot_index: number;
  start_ms: number;
  end_ms: number;
  player_index: number | null;
  shot_type: string | null;
  stroke_type: string | null;
  stroke_side: string | null;
  vertical_type: string | null;
  quality: number | null;
  is_final: boolean;
  raw_data: Record<string, unknown> | null;
  // Added in migration 015 — per-shot geometry from PB Vision augmented insights.
  // null on rows that haven't been enriched yet (compact-only imports).
  contact_x: number | null;
  contact_y: number | null;
  contact_z: number | null;
  land_x: number | null;
  land_y: number | null;
  land_z: number | null;
  speed_mph: number | null;
  height_over_net: number | null;
  distance_ft: number | null;
  distance_from_baseline: number | null;
  ball_direction: string | null;
  trajectory: {
    confidence?: number;
    start?: { ms?: number; location?: { x: number; y: number; z: number }; zone?: string };
    peak?: { x: number; y: number; z: number };
    end?: { ms?: number; location?: { x: number; y: number; z: number }; zone?: string };
  } | null;
  player_positions: Array<{ x: number; y: number }> | null;
  advantage_scale: number[] | null;
  shot_errors: Record<string, unknown> | null;
}

export interface PlayerRatingSnapshot {
  id: string;
  player_id: string;
  game_id: string;
  org_id: string;
  played_at: string;
  rating_overall: number | null;
  rating_serve: number | null;
  rating_return: number | null;
  rating_offense: number | null;
  rating_defense: number | null;
  rating_agility: number | null;
  rating_consistency: number | null;
  won: boolean | null;
  team_score: number | null;
  opponent_score: number | null;
}

export interface PlayerAggregate {
  player_id: string;
  org_id: string;
  games_played: number;
  games_won: number;
  win_rate: number | null;
  latest_rating_overall: number | null;
  latest_rating_serve: number | null;
  latest_rating_return: number | null;
  latest_rating_offense: number | null;
  latest_rating_defense: number | null;
  latest_rating_agility: number | null;
  latest_rating_consistency: number | null;
  avg_rating_overall: number | null;
  avg_rating_serve: number | null;
  avg_rating_return: number | null;
  avg_rating_offense: number | null;
  avg_rating_defense: number | null;
  avg_rating_agility: number | null;
  avg_rating_consistency: number | null;
  peak_rating_overall: number | null;
  total_shots: number;
  total_rallies: number;
  total_rallies_won: number;
  avg_distance_per_game: number | null;
  last_played_at: string | null;
  updated_at: string;
}

// -- View types --

export interface LeaderboardEntry {
  player_id: string;
  org_id: string;
  display_name: string;
  player_slug: string;
  games_played: number;
  games_won: number;
  win_rate: number | null;
  latest_rating_overall: number | null;
  latest_rating_serve: number | null;
  latest_rating_return: number | null;
  latest_rating_offense: number | null;
  latest_rating_defense: number | null;
  latest_rating_agility: number | null;
  latest_rating_consistency: number | null;
  avg_rating_overall: number | null;
  peak_rating_overall: number | null;
  last_played_at: string | null;
}

export interface PlayerGameHistoryEntry {
  player_id: string;
  org_id: string;
  game_id: string;
  pbvision_video_id: string;
  session_name: string | null;
  played_at: string | null;
  num_players: number;
  team: number;
  won: boolean | null;
  team0_score: number | null;
  team1_score: number | null;
  rating_overall: number | null;
  rating_serve: number | null;
  rating_return: number | null;
  rating_offense: number | null;
  rating_defense: number | null;
  rating_agility: number | null;
  rating_consistency: number | null;
  shot_count: number | null;
  num_rallies: number | null;
  num_rallies_won: number | null;
  distance_covered: number | null;
  shot_quality: ShotQualityDistribution | null;
  shot_selection: ShotSelectionDistribution | null;
  coaching_advice: CoachingAdviceItem[] | null;
}

// -- JSONB field types --

export interface DepthDistribution {
  out: number;
  net: number;
  shallow: number;
  medium: number;
  deep: number;
}

export interface ShotQualityDistribution {
  excellent: number;
  good: number;
  average: number;
  fair: number;
  poor: number;
}

export interface ShotSelectionDistribution {
  drive: number;
  dink: number;
  reset: number;
  drop: number;
}

export interface ShotAccuracyDistribution {
  net: number;
  out: number;
  in: number;
}

export interface KitchenArrivalFraction {
  numerator: number;
  denominator: number;
}

export interface KitchenArrivalRole {
  oneself: KitchenArrivalFraction;
  partner: KitchenArrivalFraction;
}

export interface KitchenArrivalPct {
  serving: KitchenArrivalRole;
  returning: KitchenArrivalRole;
}

export interface KitchenArrivalsSummary {
  receiving_side: number;
  serving_side: number;
}

export interface RoleStats {
  total: number;
  kitchen_arrival: number;
}

export interface RoleData {
  receiving: { oneself: RoleStats; partner: RoleStats };
  serving: { oneself: RoleStats; partner: RoleStats };
}

export interface CoachingAdviceItem {
  kind: string;
  relevance: number;
  value: number;
  ci: [number, number];
  method: string;
}

export interface BallDirections {
  mid_cross_left_count?: number;
  mid_cross_right_count?: number;
  down_the_middle_count?: number;
  left_to_middle_count?: number;
  left_cross_right_count?: number;
  down_the_line_left_count?: number;
  right_to_middle_count?: number;
  right_cross_left_count?: number;
  down_the_line_right_count?: number;
}

export interface HighlightEvent {
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

export interface OutcomeStats {
  attempt_percentage?: number;
  success_percentage?: number;
  high_quality_shot_rally_won_percentage?: number;
  low_quality_shot_rally_won_percentage?: number;
  out_fault_percentage?: number;
  net_fault_percentage?: number;
  rally_won_percentage?: number;
}

export interface SpeedStats {
  fastest?: number;
  average?: number;
  median?: number;
}

export interface GamePlayerShotType {
  id: string;
  game_id: string;
  player_id: string;
  shot_type: string;
  count: number | null;
  average_quality: number | null;
  outcome_stats: OutcomeStats | null;
  speed_stats: SpeedStats | null;
  average_baseline_distance: number | null;
  median_baseline_distance: number | null;
  average_height_above_net: number | null;
  median_height_above_net: number | null;
}

export interface GamePlayerCourtZone {
  id: string;
  game_id: string;
  player_id: string;
  zone: string;
  count: number | null;
  average_quality: number | null;
  outcome_stats: OutcomeStats | null;
  speed_stats: SpeedStats | null;
  average_baseline_distance: number | null;
  median_baseline_distance: number | null;
  average_height_above_net: number | null;
  median_height_above_net: number | null;
}
