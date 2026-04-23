-- =============================================================
-- Migration 019: Per-player coaching themes (AI-generated,
-- coach-editable).
--
-- The coach runs an AI pass over all of a player's games in a session,
-- which returns N "common themes" — each with a title, a "here's the
-- problem" description, and a "here's the solution" prescription. Those
-- are persisted here so the coach can edit them (they tune the AI copy
-- to their own voice) and so re-opening the session report loads the
-- existing themes instead of regenerating from scratch.
--
-- Scope: tied to (org, player, session). A player can have many themes
-- per session, ordered by `order_idx` for the coach's preferred
-- presentation order.
-- =============================================================

CREATE TABLE IF NOT EXISTS player_coaching_themes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

    -- Short headline (e.g. "Over-driving the 3rd shot"). Shown as the
    -- card title in the UI.
    title       TEXT NOT NULL,
    -- "Here's the problem" — what the AI / coach observed across games.
    problem     TEXT NOT NULL,
    -- "Here's the solution" — what to practice / change.
    solution    TEXT NOT NULL,

    -- Display order within a session's themes. Coach can reorder.
    order_idx   INTEGER NOT NULL DEFAULT 0,
    -- Provenance. Lets the UI badge coach-edited themes differently
    -- from untouched AI output.
    source      TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'coach')),
    edited      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_session_player
    ON player_coaching_themes(session_id, player_id, order_idx);
CREATE INDEX IF NOT EXISTS idx_themes_org ON player_coaching_themes(org_id);

CREATE TRIGGER trg_themes_updated
    BEFORE UPDATE ON player_coaching_themes
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);

-- RLS — match the rest of the coaching tables: public read for
-- analyses marked public (none here yet; we just allow any org-member
-- read), coach-only write.
ALTER TABLE player_coaching_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read themes" ON player_coaching_themes
    FOR SELECT USING (has_org_access(org_id));

CREATE POLICY "coaches write themes" ON player_coaching_themes
    FOR ALL
    USING (is_coach(org_id))
    WITH CHECK (is_coach(org_id));
