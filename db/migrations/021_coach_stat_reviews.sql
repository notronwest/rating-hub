-- =============================================================
-- Migration 021: Stat Review entries
--
-- The Game Stats view lets a coach hover any per-player stat row
-- (Kitchen Arrival, Shot Distribution, Rallies Won) and click
-- "+ Add to review". Doing so creates a row here, and the Coach
-- Review page surfaces a new "Stats to Review" section between
-- WMPC Analysis and the Review Queue listing each added stat as
-- its own topic — same shell as a WMPC pattern (FPTM diagnosis,
-- drills, overall note, per-rally instance timeline).
--
-- Scope: per (analysis, player, stat_key). Adding the same stat
-- twice is a no-op via the unique constraint. Recommendations
-- themselves piggyback on `analysis_topic_recommendations` using
-- topic_id = `stat.kitchen_arrival_serving` (etc.) — no separate
-- editor needed.
--
-- Stat keys (extensible — string-typed so new stats don't need a
-- migration):
--   stat.kitchen_arrival.serving
--   stat.kitchen_arrival.returning
--   stat.shot_share
--   stat.rally_win
-- =============================================================

CREATE TABLE IF NOT EXISTS coach_stat_reviews (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id  UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    stat_key     TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, player_id, stat_key)
);

CREATE INDEX IF NOT EXISTS idx_coach_stat_reviews_analysis
    ON coach_stat_reviews (analysis_id);
CREATE INDEX IF NOT EXISTS idx_coach_stat_reviews_player
    ON coach_stat_reviews (player_id);

-- RLS: same pattern as analysis_topic_recommendations / sequences /
-- flagged_shots — open dev-mode policy until auth rules are tightened.
ALTER TABLE coach_stat_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_stat_reviews_read ON coach_stat_reviews;
CREATE POLICY coach_stat_reviews_read ON coach_stat_reviews
    FOR SELECT USING (true);

DROP POLICY IF EXISTS coach_stat_reviews_write ON coach_stat_reviews;
CREATE POLICY coach_stat_reviews_write ON coach_stat_reviews
    FOR ALL USING (true) WITH CHECK (true);
