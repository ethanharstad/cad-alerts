import { sqliteTable, text, integer, index, real } from 'drizzle-orm/sqlite-core'
import { desc } from 'drizzle-orm';

export const organizations = sqliteTable('organizations', {
	org_id: text('org_id').primaryKey(),
	org_key: text('org_key').notNull(),
	access_key: text('access_key').notNull(),
	name: text('name').notNull(),
	// Organization-level settings. Nullable so pre-existing rows read as null and
	// the app falls back to defaults (e.g. DEFAULT_TTS_TEMPLATE).
	default_city: text('default_city'),
	default_state: text('default_state'),
	tts_template: text('tts_template'),
	actionable_window_minutes: integer('actionable_window_minutes'),
	// Built-in alert tone ids (see shared/alertTones.ts); null plays no tone.
	alert_tone: text('alert_tone'),
	quiet_alert_tone: text('quiet_alert_tone'),
	// Quiet hours as minutes after local midnight; both null means none.
	quiet_hours_start: integer('quiet_hours_start'),
	quiet_hours_end: integer('quiet_hours_end'),
	// Newline-separated pre-alert senders (see shared/senders.ts); null allows all.
	allowed_senders: text('allowed_senders'),
	// Admin-only soft caps on alerts per rolling hour / 30 days; null is no cap.
	// Set by hand in SQL, never through the API.
	alert_cap_hourly: integer('alert_cap_hourly'),
	alert_cap_monthly: integer('alert_cap_monthly'),
}, (table) => ({
	orgKeyIdx: index('idx_organization_key').on(table.org_key),
}))

export const alerts = sqliteTable('alerts', {
	alert_id: text('alert_id').primaryKey(),
	organization: text('organization').notNull().references(() => organizations.org_id),
	body: text('body').notNull(),
	audio_url: text('audio_url').notNull(),
	// When the incident happened: orders the recent list and is held fixed when a
	// follow-up email revises the incident, so the alert keeps its place.
	timestamp: integer('timestamp').notNull(),
	// When the row last changed: equal to `timestamp` on insert, bumped on every
	// update. The SSE tail cursors on this so revisions reach the stream too.
	updated_at: integer('updated_at').notNull(),
	source: text('source').notNull(),
	address: text('address').notNull(),
	city: text('city').notNull(),
	nature: text('nature').notNull(),
	latitude: real('latitude'),
	longitude: real('longitude'),
}, (table) => ({
	latestAlertsIdx: index('idx_latest_alerts_for_org').on(table.organization, desc(table.timestamp)),
	updatedAlertsIdx: index('idx_alerts_updated_for_org').on(table.organization, table.updated_at),
}))

export type Organization = typeof organizations.$inferSelect
export type Alert = typeof alerts.$inferSelect

// Compile-time guard: the Drizzle row types must remain assignable to the
// shared API contract in shared/types.ts. If the schema drifts (a renamed or
// retyped column), these aliases fail the `extends` constraint and break the
// type-check, forcing shared/types.ts to be updated in lockstep.
import type { Organization as OrganizationContract, Alert as AlertContract } from '../shared/types'
type AssertAssignable<_A extends _B, _B> = true
type _OrgContractGuard = AssertAssignable<Organization, OrganizationContract>
type _AlertContractGuard = AssertAssignable<Alert, AlertContract>
