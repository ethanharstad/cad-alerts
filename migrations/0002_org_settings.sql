-- Organization-level settings: default city/state (for later address
-- disambiguation / mapping) and the per-org token-based text-to-speech template.
-- Columns are nullable, so existing rows backfill as NULL and the app falls back
-- to its defaults. SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS, but
-- d1_migrations tracks applied migrations so this file only runs once.

ALTER TABLE organizations ADD COLUMN default_city TEXT;
ALTER TABLE organizations ADD COLUMN default_state TEXT;
ALTER TABLE organizations ADD COLUMN tts_template TEXT;
