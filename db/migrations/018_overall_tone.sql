-- =============================================================
-- Migration 018: Overall report-card tone
--
-- Adds a simple "needs work" / "good job" framing to the per-game
-- overall notes. Lets the coach indicate at a glance whether this
-- game's report-card summary is celebrating something or flagging
-- something for work.
--
-- Stored as TEXT (not an enum) so the set of allowed values can
-- evolve without a schema change. Values currently used:
--   'good_job'  — highlight; the player did something well
--   'needs_work' — growth area; something to work on
-- =============================================================

ALTER TABLE game_analyses
    ADD COLUMN IF NOT EXISTS overall_tone TEXT
        CHECK (overall_tone IN ('good_job', 'needs_work'));
