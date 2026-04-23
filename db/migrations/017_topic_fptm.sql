-- =============================================================
-- Migration 017: FPTM + drills on topic recommendations
-- =============================================================
-- WMPC Analysis topics now carry a full FPTM diagnosis (per-pillar tone +
-- notes) alongside the free-form recommendation text ("overall note") and
-- drills — same shape as review items. Existing rows default to NULL.

ALTER TABLE analysis_topic_recommendations
    ADD COLUMN IF NOT EXISTS fptm   JSONB,
    ADD COLUMN IF NOT EXISTS drills TEXT;
