// Types matching db/migrations/007_coach_analysis.sql
import type { FptmValue } from "../lib/fptm";

export interface GameAnalysis {
  id: string;
  game_id: string;
  org_id: string;
  coach_id: string;
  video_url: string | null;
  overall_notes: string | null;
  /** Coach's one-line framing of the report card — is this a "good job" /
   *  "needs work" summary? Optional; null until the coach picks one. */
  overall_tone: "good_job" | "needs_work" | null;
  is_public: boolean;
  dismissed_loss_keys: string[];
  created_at: string;
  updated_at: string;
}

/** Per-session × per-player coach takeaway. Sibling to GameAnalysis but
 *  scoped one level up — holds the SESSION-wide overall_note + tone +
 *  dismissed_loss_keys. Per-rally items (flags / sequences / losses)
 *  still pin to per-game GameAnalysis rows; this is just the synthesis
 *  the coach writes once across the whole session. Added in migration 026. */
export interface SessionAnalysis {
  id: string;
  org_id: string;
  session_id: string;
  player_id: string;
  coach_id: string | null;
  overall_note: string | null;
  overall_tone: "good_job" | "needs_work" | null;
  dismissed_loss_keys: string[];
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
  player_ids: string[];
  what_went_wrong: string | null;
  how_to_fix: string | null;
  fptm: FptmValue | null;
  drills: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlaggedShot {
  id: string;
  analysis_id: string;
  shot_id: string;
  note: string | null;
  fptm: FptmValue | null;
  drills: string | null;
  created_at: string;
}

/** A coach-added entry on the "Stats to Review" panel. The stat_key
 *  is an open string so new stats can be added without DB changes —
 *  current values: stat.kitchen_arrival.serving, stat.kitchen_arrival.returning,
 *  stat.shot_share, stat.rally_win.
 *
 *  Scope is either per-game (analysis_id set) or per-session (session_id
 *  set, added in migration 026). Exactly one is non-null. */
export interface CoachStatReview {
  id: string;
  analysis_id: string | null;
  session_id: string | null;
  player_id: string;
  stat_key: string;
  created_at: string;
}
