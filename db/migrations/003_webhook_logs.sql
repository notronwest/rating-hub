-- =============================================================
-- Migration 003: Webhook logs for PB Vision auto-import
-- =============================================================

CREATE TABLE webhook_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    video_id        TEXT NOT NULL,
    session_id      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, success, error
    sessions_found  SMALLINT,
    games_imported  SMALLINT,
    players_found   SMALLINT,
    error_message   TEXT,
    payload         JSONB,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_webhook_logs_video_id ON webhook_logs(video_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read webhook_logs"
    ON webhook_logs FOR SELECT
    USING (true);

CREATE POLICY "Service role insert webhook_logs"
    ON webhook_logs FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service role update webhook_logs"
    ON webhook_logs FOR UPDATE
    USING (true);
