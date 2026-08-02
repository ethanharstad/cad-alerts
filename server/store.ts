import { drizzle } from 'drizzle-orm/d1';
import { eq, asc, desc, and, gte } from 'drizzle-orm';

import { organizations, alerts } from './schema';
import type { Organization, Alert, OrgSettings } from '../shared/types';

/**
 * The Alert store — the single seam through which the app reads and writes
 * organizations and alerts. Callers (the Hono API and the `AlertWorkflow`)
 * depend on this interface, never on Drizzle or D1 directly, so the same routes
 * and pipeline can run against an in-memory adapter in tests.
 */
export interface AlertStore {
	/**
	 * Look up an organization by its public `org_key`. Returns the full row,
	 * including the `access_key` shared secret, so the caller can authenticate.
	 * The caller is responsible for never returning `access_key` to a client.
	 */
	findOrgByKey(orgKey: string): Promise<Organization | undefined>;
	/**
	 * Update an organization's editable settings (default city/state and the TTS
	 * template), matched by `org_id`. Only the settings fields are written; the
	 * org's identity and `access_key` are untouched.
	 */
	updateOrgSettings(orgId: string, settings: OrgSettings): Promise<void>;
	/** The most recent `limit` alerts for an organization, newest first. */
	latestAlerts(orgId: string, limit: number): Promise<Alert[]>;
	/**
	 * Alerts for an organization whose `updated_at` is at or after `since` (epoch
	 * ms), oldest change first. This is the tail query behind the SSE stream: the
	 * handler advances an `updated_at` cursor and re-runs this to pick up both
	 * newly-inserted alerts and revisions to existing ones — which is why it
	 * cursors on `updated_at` rather than `timestamp`, since a revised incident
	 * deliberately keeps its original `timestamp`. The `>=` bound can return a
	 * same-millisecond boundary alert the client already has, so clients
	 * deduplicate by `alert_id`.
	 */
	alertsSince(orgId: string, since: number): Promise<Alert[]>;
	/**
	 * A single alert scoped to its organization, or `undefined` when no alert
	 * with that id belongs to the org.
	 */
	findAlert(orgId: string, alertId: string): Promise<Alert | undefined>;
	/**
	 * The dedup probe: the most recent alert for an org at the same
	 * `(address, city)` whose `timestamp` is at or after `since` (epoch ms), or
	 * `undefined` when none. Multiple pre-alert emails for one incident share a
	 * location, so a match within the dedup window is the same incident.
	 */
	findRecentMatch(
		orgId: string,
		address: string,
		city: string,
		since: number,
	): Promise<Alert | undefined>;
	/** Persist a fully-formed alert row. */
	insertAlert(alert: Alert): Promise<void>;
	/**
	 * Refresh an existing incident's mutable details in place, matched by
	 * `(organization, alert_id)`. Only the fields that change between emails for
	 * the same incident are written (`body`, `audio_url`, `source`, `nature`,
	 * `latitude`, `longitude`), plus `updated_at` so the change surfaces on the
	 * SSE tail; `alert_id`, `timestamp`, `organization`, `address`, and `city` are
	 * left untouched so the alert keeps its identity, its position in the recent
	 * list, and its dedup match key.
	 */
	updateAlert(alert: Alert): Promise<void>;
}

/**
 * The production adapter: satisfies {@link AlertStore} against a Cloudflare D1
 * database via Drizzle. Thin by design — every method is straightforward query
 * construction, and the returned rows are tied to the shared contract types by
 * the compile-time guard in `schema.ts`.
 */
export function createD1Store(d1: D1Database): AlertStore {
	const db = drizzle(d1);
	return {
		async findOrgByKey(orgKey) {
			const org = await db
				.select()
				.from(organizations)
				.where(eq(organizations.org_key, orgKey))
				.get();
			return org ?? undefined;
		},
		async updateOrgSettings(orgId, settings) {
			await db
				.update(organizations)
				.set({
					default_city: settings.default_city,
					default_state: settings.default_state,
					tts_template: settings.tts_template,
					actionable_window_minutes: settings.actionable_window_minutes,
				})
				.where(eq(organizations.org_id, orgId));
		},
		async latestAlerts(orgId, limit) {
			return db
				.select()
				.from(alerts)
				.where(eq(alerts.organization, orgId))
				.orderBy(desc(alerts.timestamp))
				.limit(limit);
		},
		async alertsSince(orgId, since) {
			return db
				.select()
				.from(alerts)
				.where(and(eq(alerts.organization, orgId), gte(alerts.updated_at, since)))
				.orderBy(asc(alerts.updated_at));
		},
		async findAlert(orgId, alertId) {
			const alert = await db
				.select()
				.from(alerts)
				.where(and(eq(alerts.organization, orgId), eq(alerts.alert_id, alertId)))
				.get();
			return alert ?? undefined;
		},
		async findRecentMatch(orgId, address, city, since) {
			const alert = await db
				.select()
				.from(alerts)
				.where(and(
					eq(alerts.organization, orgId),
					eq(alerts.address, address),
					eq(alerts.city, city),
					gte(alerts.timestamp, since),
				))
				.orderBy(desc(alerts.timestamp))
				.limit(1)
				.get();
			return alert ?? undefined;
		},
		async insertAlert(alert) {
			await db.insert(alerts).values(alert);
		},
		async updateAlert(alert) {
			await db
				.update(alerts)
				.set({
					body: alert.body,
					audio_url: alert.audio_url,
					source: alert.source,
					nature: alert.nature,
					latitude: alert.latitude,
					longitude: alert.longitude,
					updated_at: alert.updated_at,
				})
				.where(and(
					eq(alerts.organization, alert.organization),
					eq(alerts.alert_id, alert.alert_id),
				));
		},
	};
}
