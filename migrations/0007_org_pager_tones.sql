-- Migration number: 0007 	 2026-11-01T21:40:00.000Z

-- Pager tone sets. A department lists the two-tone sequential pages (tone A,
-- then tone B) that dispatch uses to tone it out, one per line as
-- `<A Hz> <B Hz> [label]`, e.g.
--   330.5 569.1 Station 1
--   1092.4 832.5 All call
-- (see shared/pagerTones.ts). A dashboard listening to the pager audio cuts a
-- pre-alert off when it hears one of them, so it never talks over the real
-- dispatch. Only these sets count, since county-wide dispatch shares the
-- channel with other agencies.
--
-- Nullable: existing rows read as NULL, which means no tone sets — no
-- preemption, exactly today's behavior.

ALTER TABLE organizations ADD COLUMN pager_tone_sets TEXT;
