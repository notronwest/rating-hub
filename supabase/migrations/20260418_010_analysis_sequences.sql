-- =============================================================
-- Migration 010: Coach-authored sequences within a rally
-- =============================================================
-- A "sequence" is an ordered subset of shots within a single rally, saved
-- by a coach with teaching notes (what went wrong + how to fix it) so the
-- same chain of plays can be replayed and discussed later.

CREATE TABLE game_analysis_sequences (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id       UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    rally_id          UUID NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
    shot_ids          UUID[] NOT NULL DEFAULT '{}',
    label             TEXT,
    player_id         UUID REFERENCES players(id) ON DELETE SET NULL,
    what_went_wrong   TEXT,
    how_to_fix        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sequences_analysis ON game_analysis_sequences(analysis_id);
CREATE INDEX idx_sequences_rally ON game_analysis_sequences(rally_id);
CREATE INDEX idx_sequences_player ON game_analysis_sequences(player_id);

ALTER TABLE game_analysis_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read analysis_sequences"
    ON game_analysis_sequences FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id
          AND (a.is_public = TRUE OR has_org_access(a.org_id))
    ));

CREATE POLICY "coaches write analysis_sequences"
    ON game_analysis_sequences FOR ALL
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ));

CREATE TRIGGER trg_analysis_sequences_updated
    BEFORE UPDATE ON game_analysis_sequences
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);
