-- =============================================================
-- Migration 021: Make session_id optional on rating_report_emails.
--
-- The send-from-player-profile flow sends a rolling-window report
-- (last N games across all sessions) rather than a session-scoped
-- one. Those emails don't belong to any single session, so session_id
-- becomes nullable.
--
-- The Session Detail page's delivery log will simply hide NULL-session
-- rows (or show them separately); nothing else in the schema changes.
-- =============================================================

ALTER TABLE rating_report_emails
    ALTER COLUMN session_id DROP NOT NULL;
