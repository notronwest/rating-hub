-- =============================================================
-- Migration 004: Sessions (group games by date + player group)
-- =============================================================

-- 1. Create sessions table
CREATE TABLE sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    played_date       DATE NOT NULL,
    player_group_key  TEXT NOT NULL,   -- sorted comma-joined player UUIDs
    label             TEXT,            -- auto-generated or user-provided name
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (org_id, played_date, player_group_key)
);

CREATE INDEX idx_sessions_org ON sessions(org_id);
CREATE INDEX idx_sessions_date ON sessions(org_id, played_date DESC);

-- 2. Add session_id to games
ALTER TABLE games ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id);
CREATE INDEX idx_games_session ON games(session_id);

-- 3. RLS + dev policies
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read sessions"
    ON sessions FOR SELECT USING (true);
CREATE POLICY "Dev: allow all inserts" ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Dev: allow all updates" ON sessions FOR UPDATE USING (true);
CREATE POLICY "Dev: allow all deletes" ON sessions FOR DELETE USING (true);

-- =============================================================
-- 4. Backfill: group existing games into sessions
-- =============================================================

-- For each game, compute a player_group_key (sorted player UUIDs)
-- and group by (org_id, date, player_group_key) to create sessions.

-- Step 4a: Create a temp table with game → player_group_key mapping
CREATE TEMP TABLE tmp_game_groups AS
SELECT
    g.id AS game_id,
    g.org_id,
    (g.played_at AT TIME ZONE 'UTC')::date AS played_date,
    STRING_AGG(gp.player_id::text, ',' ORDER BY gp.player_id) AS player_group_key
FROM games g
JOIN game_players gp ON gp.game_id = g.id
WHERE g.session_id IS NULL
GROUP BY g.id, g.org_id, (g.played_at AT TIME ZONE 'UTC')::date;

-- Step 4b: Build labels from player first names + date
CREATE TEMP TABLE tmp_session_labels AS
SELECT DISTINCT
    tgg.org_id,
    tgg.played_date,
    tgg.player_group_key,
    STRING_AGG(
        SPLIT_PART(p.display_name, ' ', 1),
        '-' ORDER BY p.display_name
    ) || ' ' || tgg.played_date::text AS label
FROM tmp_game_groups tgg
JOIN LATERAL unnest(string_to_array(tgg.player_group_key, ',')) AS pid ON true
JOIN players p ON p.id = pid::uuid
GROUP BY tgg.org_id, tgg.played_date, tgg.player_group_key;

-- Step 4c: Insert distinct sessions
INSERT INTO sessions (org_id, played_date, player_group_key, label)
SELECT
    org_id,
    played_date,
    player_group_key,
    label
FROM tmp_session_labels
ON CONFLICT (org_id, played_date, player_group_key) DO NOTHING;

DROP TABLE tmp_session_labels;

-- Step 4d: Set session_id on games
UPDATE games g
SET session_id = s.id
FROM tmp_game_groups tgg
JOIN sessions s ON s.org_id = tgg.org_id
    AND s.played_date = tgg.played_date
    AND s.player_group_key = tgg.player_group_key
WHERE g.id = tgg.game_id
  AND g.session_id IS NULL;

-- Step 4e: Cleanup
DROP TABLE tmp_game_groups;
