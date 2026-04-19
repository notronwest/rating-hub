-- =============================================================
-- Migration 006: Email column on players
-- =============================================================
--
-- Adds email to players so sync flows can use it as a stable identity
-- key (instead of brittle first+last name matching). Case-insensitive
-- unique per org, nullable so players without a known email are
-- unaffected.

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_org_email
    ON players(org_id, lower(email))
    WHERE email IS NOT NULL;
