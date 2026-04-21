-- =============================================================
-- Migration 014: Dismissible rally losses on Coach Review
-- =============================================================
-- Coaches may decide a given auto-attributed rally loss isn't coachable or
-- worth reviewing (e.g. winners from the opponent, random coin-flip points).
-- Those get tossed onto the analysis row so the loss doesn't keep reappearing
-- in the review checklist.
--
-- Key shape mirrors `PlayerLoss.itemKey`: "loss:<rallyId>:<attributedShotId>".

ALTER TABLE game_analyses
    ADD COLUMN IF NOT EXISTS dismissed_loss_keys TEXT[] NOT NULL DEFAULT '{}';
