-- =============================================================
-- Migration 011: Coach-flagged shots for later review
-- =============================================================
-- Lightweight bookmarking: as a coach watches through a game, they can flag
-- individual shots ("interesting", "re-watch", etc.) and come back to them.
-- Scoped to an analysis so multiple coaches' flags for the same game coexist.

CREATE TABLE analysis_flagged_shots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id   UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    shot_id       UUID NOT NULL REFERENCES rally_shots(id) ON DELETE CASCADE,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, shot_id)
);

CREATE INDEX idx_flagged_shots_analysis ON analysis_flagged_shots(analysis_id);
CREATE INDEX idx_flagged_shots_shot ON analysis_flagged_shots(shot_id);

ALTER TABLE analysis_flagged_shots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read flagged_shots"
    ON analysis_flagged_shots FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id
          AND (a.is_public = TRUE OR has_org_access(a.org_id))
    ));

CREATE POLICY "coaches write flagged_shots"
    ON analysis_flagged_shots FOR ALL
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ));
