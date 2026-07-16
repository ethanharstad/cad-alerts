import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { timingSafeEqual } from 'hono/utils/buffer';

import type { Organization, PublicOrganization } from '../shared/types';
import type { AlertStore } from './store';

type Variables = { organization: Organization; store: AlertStore };

/**
 * Build the Hono app around an Alert store. The store arrives through a
 * resolver — `(env) => AlertStore` — because a Worker's bindings (`env`) only
 * exist per request, so the D1-backed store cannot be built at module load.
 * Production wires `(env) => createD1Store(env.db)`; tests pass
 * `() => createInMemoryStore(...)` and never touch Drizzle.
 */
export function createApp(resolveStore: (env: Env) => AlertStore) {
	const app = new Hono<{ Bindings: Env; Variables: Variables }>().basePath('/api/');

	// Resolve the request's store once and stash it for handlers and middleware.
	app.use('*', async (c, next) => {
		c.set('store', resolveStore(c.env));
		await next();
	});

	/**
	 * Authenticate a request against the organization named in the
	 * `:organizationKey` route param. The organization's `access_key` acts as a
	 * shared secret that the client must present as `Authorization: Bearer
	 * <access_key>`. On success the organization row is stashed on the context so
	 * handlers can reuse it without a second lookup.
	 */
	const requireOrgAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
		const organizationKey = c.req.param('organizationKey');
		if (!organizationKey) {
			throw new HTTPException(404, { message: 'Organization not found' });
		}
		const organization = await c.get('store').findOrgByKey(organizationKey);
		// org_key is a public identifier, so revealing whether it exists is not
		// sensitive; a missing org is a plain 404.
		if (!organization) {
			throw new HTTPException(404, { message: 'Organization not found' });
		}

		const header = c.req.header('Authorization') ?? '';
		const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
		// timingSafeEqual hashes both operands, so it is constant-time and safe even
		// when the provided token and the secret differ in length.
		if (token.length === 0 || !(await timingSafeEqual(token, organization.access_key))) {
			throw new HTTPException(401, { message: 'Invalid or missing credentials' });
		}

		c.set('organization', organization);
		await next();
	});

	app.get('/org/:organizationKey', requireOrgAuth, async (c) => {
		const { org_id, org_key, name } = c.get('organization');
		// Never return access_key to the client.
		const publicOrganization: PublicOrganization = { org_id, org_key, name };
		return c.json(publicOrganization);
	});

	app.get('/org/:organizationKey/alerts', requireOrgAuth, async (c) => {
		const organization = c.get('organization');
		const alertsList = await c.get('store').latestAlerts(organization.org_id, 5);
		return c.json(alertsList);
	});

	app.get('/org/:organizationKey/alerts/:alertId/audio', requireOrgAuth, async (c) => {
		const organization = c.get('organization');
		const alertId = c.req.param('alertId');

		// Get the alert and verify it belongs to the organization.
		const alert = await c.get('store').findAlert(organization.org_id, alertId);

		if (!alert) {
			throw new HTTPException(404, { message: 'Alert not found' });
		}

		if (!alert.audio_url) {
			throw new HTTPException(404, { message: 'Audio file not found for this alert' });
		}

		// Fetch the audio file from R2 bucket.
		const audioFile = await c.env.bucket.get(alert.audio_url);

		if (!audioFile) {
			throw new HTTPException(404, { message: 'Audio file not found in storage' });
		}

		// Return the audio file with appropriate headers.
		return new Response(audioFile.body, {
			headers: {
				'Content-Type': 'audio/mpeg',
				'Content-Disposition': `inline; filename="${alertId}.mp3"`,
				'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
			},
		});
	});

	return app;
}
