-- =============================================================
-- Migration 026: Move coaching synthesis from per-game to per-session.
--
-- Rationale: the coach now reviews a player's whole session in one
-- pass. Per-rally items (flags, sequences, rally losses) stay keyed
-- on their game's analysis — they pin to specific shots which only
-- exist in their game. But the coaching SYNTHESIS the coach writes
-- on top of those items (FPTM, drills, recommendations, overall
-- takeaways, dismissed-losses, stats to review) becomes session-
-- scoped so the coach writes it once per session per player rather
-- than re-typing it for each game.
--
-- Three table changes:
--   1. New `session_analyses` (per session × player) holds the
--      session-wide overall_note / overall_tone / dismissed_loss_keys.
--      Mirrors game_analyses' coach-takeaway fields, scoped one level up.
--   2. `analysis_topic_recommendations` gains nullable `session_id`.
--      A row is now scoped EITHER per-game (analysis_id set) OR
--      per-session (session_id set). Existing per-game rows untouched.
--   3. `coach_stat_reviews` gains nullable `session_id` similarly.
--
-- Per the design call: existing per-game rows are NOT migrated. They
-- remain queryable for the legacy per-game CoachReview workflow if we
-- ever need it. New session-level work creates new session-scoped rows.
-- =============================================================

-- ── 1. session_analyses ──
CREATE TABLE IF NOT EXISTS session_analyses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    coach_id     UUID,
    overall_note TEXT,
    overall_tone TEXT CHECK (overall_tone IS NULL OR overall_tone IN ('good_job', 'needs_work')),
    -- Loss-key shape mirrors game_analyses.dismissed_loss_keys —
    -- "loss:<rallyId>:<attributedShotId>". Coach can dismiss losses
    -- session-wide so they don't show up in any game's review queue.
    dismissed_loss_keys TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_session_analyses_session_player
    ON session_analyses (session_id, player_id);
CREATE INDEX IF NOT EXISTS idx_session_analyses_org
    ON session_analyses (org_id);

CREATE TRIGGER trg_session_analyses_modtime
    BEFORE UPDATE ON session_analyses
    FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

ALTER TABLE session_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_analyses_read ON session_analyses;
CREATE POLICY session_analyses_read ON session_analyses
    FOR SELECT USING (true);
DROP POLICY IF EXISTS session_analyses_write ON session_analyses;
CREATE POLICY session_analyses_write ON session_analyses
    FOR ALL USING (true) WITH CHECK (true);

-- ── 2. analysis_topic_recommendations: allow session-level rows ──
ALTER TABLE analysis_topic_recommendations
    ALTER COLUMN analysis_id DROP NOT NULL;
ALTER TABLE analysis_topic_recommendations
    ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

-- A row must be scoped to either a game (analysis_id) or a session,
-- not both, not neither.
ALTER TABLE analysis_topic_recommendations
    DROP CONSTRAINT IF EXISTS topic_reco_scope_check;
ALTER TABLE analysis_topic_recommendations
    ADD CONSTRAINT topic_reco_scope_check
        CHECK (
            (analysis_id IS NOT NULL AND session_id IS NULL) OR
            (analysis_id IS NULL     AND session_id IS NOT NULL)
        );

-- Session-level rows are unique on (session_id, player_id, topic_id).
-- Per-game uniqueness still enforced by the existing
-- (analysis_id, player_id, topic_id) UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_reco_session_unique
    ON analysis_topic_recommendations (session_id, player_id, topic_id)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topic_reco_session
    ON analysis_topic_recommendations (session_id, player_id)
    WHERE session_id IS NOT NULL;

-- ── 3. coach_stat_reviews: allow session-level rows ──
ALTER TABLE coach_stat_reviews
    ALTER COLUMN analysis_id DROP NOT NULL;
ALTER TABLE coach_stat_reviews
    ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE coach_stat_reviews
    DROP CONSTRAINT IF EXISTS coach_stat_reviews_scope_check;
ALTER TABLE coach_stat_reviews
    ADD CONSTRAINT coach_stat_reviews_scope_check
        CHECK (
            (analysis_id IS NOT NULL AND session_id IS NULL) OR
            (analysis_id IS NULL     AND session_id IS NOT NULL)
        );

CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_stat_reviews_session_unique
    ON coach_stat_reviews (session_id, player_id, stat_key)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coach_stat_reviews_session
    ON coach_stat_reviews (session_id, player_id)
    WHERE session_id IS NOT NULL;
