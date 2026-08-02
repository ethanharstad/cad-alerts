-- Migration number: 0004 	 2026-08-02T17:07:08.143Z

-- How recent a call must be for the dashboard to read it out loud. This is
-- department practice rather than per-kiosk preference, so it lives on the
-- organization and is shared by every dashboard using it.
--
-- Nullable: existing rows read as NULL and the app falls back to its default
-- (five minutes), the same pattern as the other org settings. SQLite's ALTER
-- TABLE ADD COLUMN has no IF NOT EXISTS, but d1_migrations tracks applied
-- migrations so this file only runs once.

ALTER TABLE organizations ADD COLUMN actionable_window_minutes INTEGER;
