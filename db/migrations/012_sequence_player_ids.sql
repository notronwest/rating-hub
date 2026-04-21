-- =============================================================
-- Migration 012: Sequence multi-player tagging
-- =============================================================
-- Sequences can now reference multiple players (e.g. a sequence tagged for
-- both partners on a team). `player_id` remains for backward compatibility
-- and is populated when exactly one player is selected.

ALTER TABLE game_analysis_sequences
    ADD COLUMN IF NOT EXISTS player_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sequences_player_ids
    ON game_analysis_sequences USING GIN (player_ids);
