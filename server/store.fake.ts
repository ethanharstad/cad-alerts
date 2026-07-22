import type { Organization, Alert, OrgSettings } from '../shared/types';
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
		async updateOrgSettings(orgId, settings) {
			const org = orgs.find((o) => o.org_id === orgId);
			if (org) {
				org.default_city = settings.default_city;
				org.default_state = settings.default_state;
				org.tts_template = settings.tts_template;
			}
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
		async findRecentMatch(orgId, address, city, since) {
			return rows
				.filter(
					(a) =>
						a.organization === orgId &&
						a.address === address &&
						a.city === city &&
						a.timestamp >= since,
				)
				.sort((a, b) => b.timestamp - a.timestamp)[0];
		},
		async insertAlert(alert) {
			rows.push(alert);
		},
		async updateAlert(alert) {
			const i = rows.findIndex(
				(a) => a.organization === alert.organization && a.alert_id === alert.alert_id,
			);
			if (i >= 0) {
				rows[i] = {
					...rows[i],
					body: alert.body,
					audio_url: alert.audio_url,
					source: alert.source,
					nature: alert.nature,
					latitude: alert.latitude,
					longitude: alert.longitude,
				};
			}
		},
	};
}
