-- =============================================================
-- Migration 024: Pinned flag for coaching priorities.
--
-- Migration 023 introduced the `priority` kind on player_coaching_themes
-- but didn't include a pin mechanic. The session-report priorities UI
-- exposes a 📌 button so a coach can lock a priority (content + rank)
-- across regenerations of the AI suggestions. Edits already act as a
-- soft pin (since coach-edited rows have `edited = true`); the explicit
-- pin lets a coach freeze a priority WITHOUT having to edit anything.
--
-- The edge function uses `pinned = true OR edited = true` as the
-- protection set when refreshing suggestions: protected rows survive
-- with their rank intact, fresh AI output fills the remaining slots.
-- =============================================================

ALTER TABLE player_coaching_themes
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- The journal already tracks 'created' / 'deleted' / per-field edits;
-- pin / unpin actions can ride on the existing `field` column with
-- new values 'pinned' / 'unpinned' — no schema change needed there.
