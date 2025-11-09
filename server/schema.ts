import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const organizations = sqliteTable('organizations', {
	org_id: text('org_id').primaryKey(),
	org_key: text('org_key').notNull(),
	access_key: text('access_key').notNull(),
	name: text('name').notNull(),
}, (table) => ({
	orgKeyIdx: index('idx_organization_key').on(table.org_key),
}))

export const alerts = sqliteTable('alerts', {
	alert_id: text('alert_id').primaryKey(),
	organization: text('organization').notNull().references(() => organizations.org_id),
	body: text('body').notNull(),
	audio_url: text('audio_url').notNull(),
	timestamp: integer('timestamp').notNull(),
	source: text('source').notNull(),
}, (table) => ({
	latestAlertsIdx: index('idx_latest_alerts_for_org').on(table.organization, table.timestamp),
}))

export type Organization = typeof organizations.$inferSelect
export type Alert = typeof alerts.$inferSelect
