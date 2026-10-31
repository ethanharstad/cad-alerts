-- Migration number: 0006 	 2026-10-31T18:00:00.000Z

-- Intake protection (issues #19 and #20).
--
-- allowed_senders: newline-separated pre-alert senders, each an exact address
-- (cad@county.gov) or a whole domain (@county.gov). NULL or empty allows every
-- sender, so existing organizations keep working. Editable in the settings UI.
--
-- alert_cap_hourly / alert_cap_monthly: soft caps on alerts (new or revised)
-- per rolling hour / rolling 30 days. Going over is logged and reported, but the
-- alert is still delivered. NULL means no cap. Admin-only: set by hand, e.g.
--   UPDATE organizations SET alert_cap_hourly = 30, alert_cap_monthly = 2000
--   WHERE org_key = 'boone';
-- They are never exposed to, or writable through, the org API.

ALTER TABLE organizations ADD COLUMN allowed_senders TEXT;
ALTER TABLE organizations ADD COLUMN alert_cap_hourly INTEGER;
ALTER TABLE organizations ADD COLUMN alert_cap_monthly INTEGER;
