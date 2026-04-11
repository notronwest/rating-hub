-- =============================================================
-- Migration 002: Stats + Insights extra data
-- =============================================================

-- New columns on game_players
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS ball_directions JSONB;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS volley_count SMALLINT;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS ground_stroke_count SMALLINT;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS final_shot_count SMALLINT;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS net_impact_score NUMERIC(5,3);
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS net_fault_percentage NUMERIC(5,3);
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS out_fault_percentage NUMERIC(5,3);
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS advanced_stats JSONB;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS highlights JSONB;

-- New column on games
ALTER TABLE games ADD COLUMN IF NOT EXISTS highlights JSONB;

-- =============================================================
-- Per-player per-game shot type breakdowns
-- =============================================================

CREATE TABLE game_player_shot_types (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id                 UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    shot_type               TEXT NOT NULL,

    count                   SMALLINT,
    average_quality         NUMERIC(5,3),
    outcome_stats           JSONB,
    speed_stats             JSONB,
    average_baseline_distance   NUMERIC(8,2),
    median_baseline_distance    NUMERIC(8,2),
    average_height_above_net    NUMERIC(8,3),
    median_height_above_net     NUMERIC(8,3),

    UNIQUE (game_id, player_id, shot_type)
);

CREATE INDEX idx_gp_shot_types_game ON game_player_shot_types(game_id);
CREATE INDEX idx_gp_shot_types_player ON game_player_shot_types(player_id);
CREATE INDEX idx_gp_shot_types_type ON game_player_shot_types(player_id, shot_type);

-- =============================================================
-- Per-player per-game court zone breakdowns
-- =============================================================

CREATE TABLE game_player_court_zones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id                 UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    zone                    TEXT NOT NULL,

    count                   SMALLINT,
    average_quality         NUMERIC(5,3),
    outcome_stats           JSONB,
    speed_stats             JSONB,
    average_baseline_distance   NUMERIC(8,2),
    median_baseline_distance    NUMERIC(8,2),
    average_height_above_net    NUMERIC(8,3),
    median_height_above_net     NUMERIC(8,3),

    UNIQUE (game_id, player_id, zone)
);

CREATE INDEX idx_gp_court_zones_game ON game_player_court_zones(game_id);
CREATE INDEX idx_gp_court_zones_player ON game_player_court_zones(player_id);
CREATE INDEX idx_gp_court_zones_zone ON game_player_court_zones(player_id, zone);

-- =============================================================
-- RLS + dev policies for new tables
-- =============================================================

ALTER TABLE game_player_shot_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_player_court_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read shot types"
    ON game_player_shot_types FOR SELECT USING (true);
CREATE POLICY "Dev: allow all inserts" ON game_player_shot_types FOR INSERT WITH CHECK (true);
CREATE POLICY "Dev: allow all updates" ON game_player_shot_types FOR UPDATE USING (true);
CREATE POLICY "Dev: allow all deletes" ON game_player_shot_types FOR DELETE USING (true);

CREATE POLICY "Public read court zones"
    ON game_player_court_zones FOR SELECT USING (true);
CREATE POLICY "Dev: allow all inserts" ON game_player_court_zones FOR INSERT WITH CHECK (true);
CREATE POLICY "Dev: allow all updates" ON game_player_court_zones FOR UPDATE USING (true);
CREATE POLICY "Dev: allow all deletes" ON game_player_court_zones FOR DELETE USING (true);
