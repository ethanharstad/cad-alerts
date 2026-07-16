import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';

import { organizations, alerts } from './schema';
import type { Organization, Alert } from '../shared/types';

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
	/** The most recent `limit` alerts for an organization, newest first. */
	latestAlerts(orgId: string, limit: number): Promise<Alert[]>;
	/**
	 * A single alert scoped to its organization, or `undefined` when no alert
	 * with that id belongs to the org.
	 */
	findAlert(orgId: string, alertId: string): Promise<Alert | undefined>;
	/** Persist a fully-formed alert row. */
	insertAlert(alert: Alert): Promise<void>;
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
		async latestAlerts(orgId, limit) {
			return db
				.select()
				.from(alerts)
				.where(eq(alerts.organization, orgId))
				.orderBy(desc(alerts.timestamp))
				.limit(limit);
		},
		async findAlert(orgId, alertId) {
			const alert = await db
				.select()
				.from(alerts)
				.where(and(eq(alerts.organization, orgId), eq(alerts.alert_id, alertId)))
				.get();
			return alert ?? undefined;
		},
		async insertAlert(alert) {
			await db.insert(alerts).values(alert);
		},
	};
}
