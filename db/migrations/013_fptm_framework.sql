-- =============================================================
-- Migration 013: FPTM framework fields for sequences + flags
-- =============================================================
-- FPTM = Footwork • Paddle • Tactics • Mindset. The coach-facing review UI
-- replaces the free-form "what went wrong / how to fix it" notes with a
-- structured diagnosis across the four pillars, plus a drills field.
--
-- `fptm` is a JSONB object keyed by pillar id ("footwork" | "paddle" |
-- "tactics" | "mindset"), each value `{ on: bool, items: string[], note?: string }`.
-- `drills` is free-form coach text listing drills to address the issues.
--
-- Legacy `what_went_wrong` / `how_to_fix` columns are left in place so
-- historical notes aren't lost; the UI stops writing to them.

ALTER TABLE game_analysis_sequences
    ADD COLUMN IF NOT EXISTS fptm   JSONB,
    ADD COLUMN IF NOT EXISTS drills TEXT;

ALTER TABLE analysis_flagged_shots
    ADD COLUMN IF NOT EXISTS fptm   JSONB,
    ADD COLUMN IF NOT EXISTS drills TEXT;
