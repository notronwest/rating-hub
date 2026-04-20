// Types matching db/migrations/007_coach_analysis.sql

export interface GameAnalysis {
  id: string;
  game_id: string;
  org_id: string;
  coach_id: string;
  video_url: string | null;
  overall_notes: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export type NoteCategory =
  | "serve"
  | "return"
  | "third"
  | "dink"
  | "movement"
  | "positioning"
  | "general";

export interface AnalysisNote {
  id: string;
  analysis_id: string;
  player_id: string | null;
  rally_id: string | null;
  timestamp_ms: number | null;
  category: NoteCategory | null;
  note: string;
  created_at: string;
}

export type AssessmentKind = "strength" | "weakness";

export interface PlayerAssessment {
  id: string;
  analysis_id: string;
  player_id: string;
  kind: AssessmentKind;
  tag: string;
  note: string | null;
  created_at: string;
}

export interface AssessmentTag {
  id: string;        // slug, e.g. "powerful_serve"
  label: string;     // human display, e.g. "Powerful serve"
  kind: "strength" | "weakness" | "both";
  category: string;  // grouping: "serve" | "return" | "third" | "dink" | "court" | "movement"
}

export interface UserOrgRoleRow {
  user_id: string;
  org_id: string;
  role: "coach" | "admin" | "viewer";
  created_at: string;
}

export interface AnalysisSequence {
  id: string;
  analysis_id: string;
  rally_id: string;
  shot_ids: string[];
  label: string | null;
  player_id: string | null;
  what_went_wrong: string | null;
  how_to_fix: string | null;
  created_at: string;
  updated_at: string;
}
