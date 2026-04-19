-- =============================================================
-- Migration 008: Add Mux playback ID to games
-- =============================================================
-- PB Vision serves videos via Mux (not direct GCS MP4s). Each game's
-- video has a Mux playback_id (~47 chars, e.g. "a00w01bJI01Ax...").
-- Coaches can paste it per game; the Analyze page uses it to stream
-- via HLS from stream.mux.com/{playback_id}.m3u8

ALTER TABLE games ADD COLUMN IF NOT EXISTS mux_playback_id TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS mux_asset_id TEXT;

COMMENT ON COLUMN games.mux_playback_id IS
    'Mux playback ID for streaming the game video via stream.mux.com';
