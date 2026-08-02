-- Migration number: 0003 	 2026-08-02T16:01:24.875Z

-- Separate "when the incident happened" from "when the row last changed".
--
-- `timestamp` orders the recent-alerts list and is deliberately held fixed when
-- a follow-up email revises an incident, so the alert keeps its place. The SSE
-- tail (`alertsSince`) used that same column as its cursor, which meant an
-- in-place update could never surface on the stream. `updated_at` gives the tail
-- its own monotonic cursor: set to `timestamp` on insert, bumped on every update.
--
-- Existing rows backfill to their `timestamp` — they have never been updated, so
-- the two are equal. SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS, but
-- d1_migrations tracks applied migrations so this file only runs once.

ALTER TABLE alerts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE alerts SET updated_at = timestamp WHERE updated_at = 0;

-- The tail filters on (organization, updated_at); the existing
-- idx_latest_alerts_for_org is on (organization, timestamp DESC) and does not
-- cover it.
CREATE INDEX IF NOT EXISTS idx_alerts_updated_for_org ON alerts (organization, updated_at);
