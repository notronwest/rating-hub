-- =============================================================
-- Migration 015: Per-shot geometry from PB Vision augmented insights
-- =============================================================
-- PB Vision's augmented insights JSON (public API, `format=augmented`) carries
-- rich per-shot geometry we've been dropping on the floor:
--   * ball trajectory (start, peak, end) with x/y/z in feet on the PBV court
--   * resulting ball movement (speed, height over net, direction, etc.)
--   * positions of all four players at contact
--   * advantage scale per player (momentum)
--
-- These columns unlock the "Patterns" analytical panels on the Coach Review
-- page (3rd Shot Contact Locations, Serve→Return, etc.). We store the two
-- primary coordinate pairs as NUMERIC (for indexable spatial queries) and
-- park the rest in JSONB for flexibility.
--
-- PB Vision court coordinates:
--   x: 0..20   (court width in feet)
--   y: 0..44   (length in feet; net at y=22)
--   z: height above ground (feet)
-- Team 0 (far) plays on y ∈ [0, 22), Team 1 (near) on y ∈ (22, 44].

ALTER TABLE rally_shots
    -- Contact point: where the player struck the ball (trajectory.start.location)
    ADD COLUMN IF NOT EXISTS contact_x NUMERIC,
    ADD COLUMN IF NOT EXISTS contact_y NUMERIC,
    ADD COLUMN IF NOT EXISTS contact_z NUMERIC,
    -- Landing point: where the ball came down (trajectory.end.location)
    ADD COLUMN IF NOT EXISTS land_x NUMERIC,
    ADD COLUMN IF NOT EXISTS land_y NUMERIC,
    ADD COLUMN IF NOT EXISTS land_z NUMERIC,
    -- Kinematics
    ADD COLUMN IF NOT EXISTS speed_mph NUMERIC,
    ADD COLUMN IF NOT EXISTS height_over_net NUMERIC,
    ADD COLUMN IF NOT EXISTS distance_ft NUMERIC,
    ADD COLUMN IF NOT EXISTS distance_from_baseline NUMERIC,
    ADD COLUMN IF NOT EXISTS ball_direction TEXT,
    -- Full trajectory object (start + peak + end + confidence + zones) —
    -- lets us draw arcs later without another migration.
    ADD COLUMN IF NOT EXISTS trajectory JSONB,
    -- All four player (x, y) positions at the moment of contact.
    -- Array of 4 objects: [{ "x": n, "y": n }, ...]
    ADD COLUMN IF NOT EXISTS player_positions JSONB,
    -- PBV's per-player momentum score for this shot.
    ADD COLUMN IF NOT EXISTS advantage_scale JSONB,
    -- Errors flagged by PBV's model on this shot (e.g. { popup: "exploited" })
    ADD COLUMN IF NOT EXISTS shot_errors JSONB;

-- Spatial index on contact location — queries like "all 3rd shots contacted
-- in the kitchen" become fast.
CREATE INDEX IF NOT EXISTS idx_rally_shots_contact
    ON rally_shots (contact_x, contact_y)
    WHERE contact_x IS NOT NULL;
