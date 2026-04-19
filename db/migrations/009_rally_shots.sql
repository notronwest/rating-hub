-- =============================================================
-- Migration 009: Rally shots (per-shot sequence within a rally)
-- =============================================================
-- Stores the shot-by-shot data from the compact insights "sh" array
-- so the Analyze page can display sequences like:
--   1. Serve (Steve, FH) · 2. Return (Ron, BH) · 3. 3rd drop (Peter, FH) …
-- and jump the video to any specific shot's timestamp.

CREATE TABLE rally_shots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rally_id                UUID NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
    shot_index              SMALLINT NOT NULL,    -- position within the rally (0-based)

    -- Timing (from compact "t": [start_ms, end_ms])
    start_ms                INTEGER NOT NULL,
    end_ms                  INTEGER NOT NULL,

    -- Who hit it (0-3, matches game_players.player_index)
    player_index            SMALLINT,

    -- Human-readable classification (derived from tags/flags during import)
    shot_type               TEXT,                 -- 'serve','return','drive','dink','drop','lob','smash','reset','speedup','volley','shot'
    stroke_type             TEXT,                 -- 'forehand','backhand','two-handed'
    stroke_side             TEXT,                 -- 'left','right'
    vertical_type           TEXT,                 -- 'neutral','topspin','slice','dig','lob'

    quality                 NUMERIC(5,3),         -- overall execution quality 0-1
    is_final                BOOLEAN NOT NULL DEFAULT FALSE,

    -- Full raw shot object for forward compatibility
    raw_data                JSONB,

    UNIQUE (rally_id, shot_index)
);

CREATE INDEX idx_rally_shots_rally ON rally_shots(rally_id, shot_index);
CREATE INDEX idx_rally_shots_player ON rally_shots(player_index);

-- RLS + dev policies
ALTER TABLE rally_shots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read rally_shots"
    ON rally_shots FOR SELECT USING (true);
CREATE POLICY "Dev: allow all inserts" ON rally_shots FOR INSERT WITH CHECK (true);
CREATE POLICY "Dev: allow all updates" ON rally_shots FOR UPDATE USING (true);
CREATE POLICY "Dev: allow all deletes" ON rally_shots FOR DELETE USING (true);
