-- Migration number: 0005 	 2026-10-18T14:15:00.000Z

-- Alert tones and quiet hours. An organization picks a built-in tone (by id,
-- see shared/alertTones.ts) to play before each alert, and optionally quiet
-- hours with a different tone. Quiet hours are stored as minutes after local
-- midnight.
--
-- Nullable: existing rows read as NULL, which means no tone and no quiet hours
-- — exactly today's behavior.

ALTER TABLE organizations ADD COLUMN alert_tone TEXT;
ALTER TABLE organizations ADD COLUMN quiet_alert_tone TEXT;
ALTER TABLE organizations ADD COLUMN quiet_hours_start INTEGER;
ALTER TABLE organizations ADD COLUMN quiet_hours_end INTEGER;
