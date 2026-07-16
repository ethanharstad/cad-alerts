import type { Organization, Alert } from '../shared/types';
import type { AlertStore } from './store';

/**
 * Seed data for {@link createInMemoryStore}. Organizations are provisioned out
 * of band in production (the store has no `insertOrg`), so tests supply them
 * here; alerts may be seeded too, or added afterwards via `insertAlert`.
 */
export interface InMemorySeed {
	orgs?: Organization[];
	alerts?: Alert[];
}

/**
 * The test adapter: satisfies {@link AlertStore} entirely in memory. This is the
 * second adapter that makes the seam real — it lets the Hono routes and the
 * pre-alert pipeline run without D1. Imported only by test files, so it never
 * enters the production Worker bundle.
 */
export function createInMemoryStore(seed: InMemorySeed = {}): AlertStore {
	const orgs = [...(seed.orgs ?? [])];
	const rows = [...(seed.alerts ?? [])];
	return {
		async findOrgByKey(orgKey) {
			return orgs.find((o) => o.org_key === orgKey);
		},
		async latestAlerts(orgId, limit) {
			return rows
				.filter((a) => a.organization === orgId)
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, limit);
		},
		async findAlert(orgId, alertId) {
			return rows.find((a) => a.organization === orgId && a.alert_id === alertId);
		},
		async insertAlert(alert) {
			rows.push(alert);
		},
	};
}
