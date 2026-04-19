-- =============================================================
-- Migration 005: CourtReserve member ID on players
-- =============================================================
--
-- Adds cr_member_id to players so external tools (session-manager,
-- schedule scrapers) can map a CourtReserve "Member #" to the
-- canonical player row.

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS cr_member_id TEXT;

-- Enforce one player per CR member within an org (NULLs allowed,
-- so players without a CR account are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_org_cr_member_id
    ON players(org_id, cr_member_id)
    WHERE cr_member_id IS NOT NULL;
