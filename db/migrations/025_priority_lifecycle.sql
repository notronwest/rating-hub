-- =============================================================
-- Migration 025: Priority lifecycle, lead-stat tracking, strengths.
--
-- Three additions for the player-growth arc:
--   1. `status` lifecycle on player_coaching_themes — draft / active /
--      archived / mastered. Coach explicitly promotes a draft to active;
--      active priorities aggregate across sessions on the player's
--      "Working on" view.
--   2. Lead-stat snapshot columns — store the value of the headline
--      stat at the moment a priority is created so we can later show
--      "▲ 18% since 4/19" without a query each render.
--   3. Extend `kind` to include 'strength' for AI-detected callouts the
--      coach can show alongside priorities.
-- =============================================================

-- 1. Lifecycle status. Existing rows default to 'draft' — coach goes
--    through and promotes them. Future generated priorities will also
--    default to 'draft' until coach approves.
ALTER TABLE player_coaching_themes
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','archived','mastered')),
    ADD COLUMN IF NOT EXISTS lead_stat_key            TEXT,
    ADD COLUMN IF NOT EXISTS lead_stat_value_at_creation NUMERIC,
    ADD COLUMN IF NOT EXISTS lead_stat_value_latest      NUMERIC,
    ADD COLUMN IF NOT EXISTS lead_stat_updated_at        TIMESTAMPTZ;

-- 2. Extend the kind enum to include 'strength'. The CHECK constraint
--    on `kind` was added in migration 023; we drop and re-add it.
ALTER TABLE player_coaching_themes DROP CONSTRAINT IF EXISTS player_coaching_themes_kind_check;
ALTER TABLE player_coaching_themes
    ADD CONSTRAINT player_coaching_themes_kind_check
        CHECK (kind IN ('theme','priority','strength'));

CREATE INDEX IF NOT EXISTS idx_themes_player_active
    ON player_coaching_themes(player_id, kind, status);

-- 3. View — active priorities + strengths across all sessions for a
--    player. Used by the "Working on" tab on the player profile.
--    Sorted by session date desc, then priority_rank asc.
CREATE OR REPLACE VIEW v_player_active_priorities AS
SELECT
    t.id,
    t.org_id,
    t.player_id,
    t.session_id,
    s.played_date AS session_played_date,
    s.label       AS session_label,
    t.kind,
    t.status,
    t.priority_rank,
    t.title,
    t.problem,
    t.solution,
    t.evidence_chips,
    t.lead_stat_key,
    t.lead_stat_value_at_creation,
    t.lead_stat_value_latest,
    t.lead_stat_updated_at,
    t.pinned,
    t.edited,
    t.source,
    t.created_at,
    t.updated_at
FROM player_coaching_themes t
JOIN sessions s ON s.id = t.session_id
WHERE t.kind IN ('priority', 'strength')
  AND t.status = 'active';
