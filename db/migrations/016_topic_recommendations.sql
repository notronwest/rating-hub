-- =============================================================
-- Migration 016: WMPC Analysis Topic recommendations
-- =============================================================
-- The Review page now treats each WMPC analysis pattern as a "topic"
-- (e.g. `script.deep_return_kitchen`, `beats.direct`). For each topic
-- we let the coach leave a single recommendation that applies to the
-- whole pattern, plus tags. Recommendations are per player per game.
--
-- Topic ids are stable strings so they're portable across codebases
-- without needing a lookup table. Known ids:
--   script.deep_serve
--   script.deep_return_kitchen
--   script.third_drop
--   script.fourth_volley
--   beats.direct
--   beats.diagonal
--
-- Future topics (pounce opportunities, dink rallies, etc.) will add
-- new ids under matching namespaces.

CREATE TABLE IF NOT EXISTS analysis_topic_recommendations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id       UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    topic_id          TEXT NOT NULL,
    recommendation    TEXT,
    tags              TEXT[] NOT NULL DEFAULT '{}',
    -- Coach acknowledged the topic but didn't leave a recommendation.
    -- Either `recommendation` being set OR `dismissed` being true counts as
    -- "addressed" for progress tracking.
    dismissed         BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (analysis_id, player_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_reco_analysis
    ON analysis_topic_recommendations (analysis_id, player_id);

-- RLS: match the pattern used by game_analysis_sequences / analysis_flagged_shots
-- (coach-only read + write within their org).
ALTER TABLE analysis_topic_recommendations ENABLE ROW LEVEL SECURITY;

-- For now allow anyone in the org to read/write (dev-mode policy, same as
-- sibling tables). Tighten with is_coach() when auth rules are finalized.
DROP POLICY IF EXISTS topic_reco_read ON analysis_topic_recommendations;
CREATE POLICY topic_reco_read ON analysis_topic_recommendations
    FOR SELECT USING (true);
DROP POLICY IF EXISTS topic_reco_write ON analysis_topic_recommendations;
CREATE POLICY topic_reco_write ON analysis_topic_recommendations
    FOR ALL USING (true) WITH CHECK (true);

-- Auto-update `updated_at` via the existing moddatetime trigger function
-- installed by migration 007.
DROP TRIGGER IF EXISTS trg_topic_reco_modtime ON analysis_topic_recommendations;
CREATE TRIGGER trg_topic_reco_modtime
    BEFORE UPDATE ON analysis_topic_recommendations
    FOR EACH ROW EXECUTE PROCEDURE moddatetime (updated_at);
