-- =============================================================
-- Migration 007: Coaches Game Analysis
-- Adds roles table, game analyses, timestamped/rally notes, and
-- per-player strength/weakness assessments. Strict RLS from day one.
-- =============================================================

-- Required for moddatetime trigger function
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- =============================================================
-- 1. User roles per org
-- =============================================================

CREATE TABLE user_org_roles (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('coach', 'admin', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_id)
);

CREATE INDEX idx_user_org_roles_org ON user_org_roles(org_id);

-- Helper: true if calling user has coach/admin role for the given org
CREATE OR REPLACE FUNCTION is_coach(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_org_roles
        WHERE user_id = auth.uid()
          AND org_id = p_org_id
          AND role IN ('coach', 'admin')
    );
$$;

-- Helper: true if calling user has ANY role in the org (for reads)
CREATE OR REPLACE FUNCTION has_org_access(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_org_roles
        WHERE user_id = auth.uid()
          AND org_id = p_org_id
    );
$$;

-- =============================================================
-- 2. Game analyses (one per game)
-- =============================================================

CREATE TABLE game_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    coach_id        UUID NOT NULL REFERENCES auth.users(id),
    video_url       TEXT,
    overall_notes   TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_analyses_org ON game_analyses(org_id);
CREATE INDEX idx_game_analyses_coach ON game_analyses(coach_id);

-- Auto-update updated_at on row change
CREATE TRIGGER trg_game_analyses_updated
    BEFORE UPDATE ON game_analyses
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);

-- =============================================================
-- 3. Timestamped / rally-linked notes
-- =============================================================

CREATE TABLE game_analysis_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id     UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    player_id       UUID REFERENCES players(id) ON DELETE SET NULL,
    rally_id        UUID REFERENCES rallies(id) ON DELETE SET NULL,
    timestamp_ms    INTEGER,
    category        TEXT,  -- 'serve', 'return', 'third', 'dink', 'movement', 'positioning', 'general'
    note            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analysis_notes_analysis ON game_analysis_notes(analysis_id);
CREATE INDEX idx_analysis_notes_player ON game_analysis_notes(player_id);
CREATE INDEX idx_analysis_notes_timestamp ON game_analysis_notes(analysis_id, timestamp_ms);

-- =============================================================
-- 4. Per-player strength/weakness assessments
-- =============================================================

CREATE TABLE player_game_assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id     UUID NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('strength', 'weakness')),
    tag             TEXT NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, player_id, kind, tag)
);

CREATE INDEX idx_assessments_player ON player_game_assessments(player_id, kind, tag);
CREATE INDEX idx_assessments_analysis ON player_game_assessments(analysis_id);

-- =============================================================
-- 5. Row Level Security
-- =============================================================

ALTER TABLE user_org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_analysis_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_game_assessments ENABLE ROW LEVEL SECURITY;

-- user_org_roles: users can only see their own role rows
CREATE POLICY "users see own roles"
    ON user_org_roles FOR SELECT
    USING (user_id = auth.uid());

-- game_analyses:
--   Read: public analyses OR any user with org access
--   Write: coaches only
CREATE POLICY "read game_analyses"
    ON game_analyses FOR SELECT
    USING (is_public = TRUE OR has_org_access(org_id));

CREATE POLICY "coaches insert game_analyses"
    ON game_analyses FOR INSERT
    WITH CHECK (is_coach(org_id) AND coach_id = auth.uid());

CREATE POLICY "coaches update game_analyses"
    ON game_analyses FOR UPDATE
    USING (is_coach(org_id))
    WITH CHECK (is_coach(org_id));

CREATE POLICY "coaches delete game_analyses"
    ON game_analyses FOR DELETE
    USING (is_coach(org_id));

-- game_analysis_notes: tied to analysis's org_id
CREATE POLICY "read analysis_notes"
    ON game_analysis_notes FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id
          AND (a.is_public = TRUE OR has_org_access(a.org_id))
    ));

CREATE POLICY "coaches write analysis_notes"
    ON game_analysis_notes FOR ALL
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ));

-- player_game_assessments: same pattern
CREATE POLICY "read assessments"
    ON player_game_assessments FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id
          AND (a.is_public = TRUE OR has_org_access(a.org_id))
    ));

CREATE POLICY "coaches write assessments"
    ON player_game_assessments FOR ALL
    USING (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM game_analyses a
        WHERE a.id = analysis_id AND is_coach(a.org_id)
    ));
