-- =============================================================
-- Migration 020: Rating-report email delivery log.
--
-- One row per email the system sends to a player about a specific
-- session's rating report. Tracks the Resend message id so we can
-- correlate delivery / open / click / bounce webhooks back to the
-- original send.
--
-- The status column is a short string (not an enum) so we can extend
-- without schema churn — values currently used:
--   pending    — row created, Resend API call not yet attempted
--   sent       — Resend accepted the payload
--   delivered  — Resend reports the mailbox accepted it
--   opened     — recipient opened the email (at least once)
--   clicked    — recipient clicked a tracked link (implies opened)
--   bounced    — hard or soft bounce
--   failed     — send itself failed (before Resend assigned a message id)
-- =============================================================

CREATE TABLE IF NOT EXISTS rating_report_emails (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    player_id           UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,

    -- Snapshotted at send time — `players.email` could change later.
    email_to            TEXT NOT NULL,
    -- Who kicked off the send (nullable for system-triggered sends we
    -- might add later).
    sent_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    resend_message_id   TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    last_error          TEXT,

    -- Rollup timestamps. Multi-open recipients update open_count +
    -- opened_at tracks the FIRST open; click_count + clicked_at behaves
    -- the same way.
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    opened_at           TIMESTAMPTZ,
    clicked_at          TIMESTAMPTZ,
    bounced_at          TIMESTAMPTZ,
    open_count          INTEGER NOT NULL DEFAULT 0,
    click_count         INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rating_report_emails_session
    ON rating_report_emails(session_id, player_id);
CREATE INDEX IF NOT EXISTS idx_rating_report_emails_player
    ON rating_report_emails(player_id, created_at DESC);
-- Webhook lookups hit this index millions of times at scale.
CREATE INDEX IF NOT EXISTS idx_rating_report_emails_resend_id
    ON rating_report_emails(resend_message_id) WHERE resend_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rating_report_emails_org
    ON rating_report_emails(org_id);

CREATE TRIGGER trg_rating_report_emails_updated
    BEFORE UPDATE ON rating_report_emails
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);

-- RLS — read for anyone in the org, write for coaches. Webhook writes
-- come in via the service-role key which bypasses RLS entirely.
ALTER TABLE rating_report_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read rating_report_emails" ON rating_report_emails
    FOR SELECT USING (has_org_access(org_id));

CREATE POLICY "coaches write rating_report_emails" ON rating_report_emails
    FOR ALL
    USING (is_coach(org_id))
    WITH CHECK (is_coach(org_id));
