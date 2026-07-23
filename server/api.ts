import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { streamSSE } from 'hono/streaming';
import { timingSafeEqual } from 'hono/utils/buffer';

import type { Organization, PublicOrganization, OrgSettings } from '../shared/types';
import type { AlertStore } from './store';
import { validateTemplate } from '../shared/ttsTemplate';

type Variables = { organization: Organization; store: AlertStore };

/**
 * Timing for the SSE alert stream. Split out so tests can drive the tail loop
 * fast (tiny poll, short cap) instead of waiting real seconds.
 * - `pollMs`: how often the stream handler re-tails the store for new alerts.
 * - `maxMs`: how long a single connection is held before the handler returns
 *   and the client reconnects — bounds per-request duration and keeps
 *   connections fresh.
 */
export interface StreamOptions {
	pollMs: number;
	maxMs: number;
}

const DEFAULT_STREAM_OPTIONS: StreamOptions = {
	pollMs: 3_000,
	maxMs: 5 * 60_000,
};

/**
 * Build the Hono app around an Alert store. The store arrives through a
 * resolver — `(env) => AlertStore` — because a Worker's bindings (`env`) only
 * exist per request, so the D1-backed store cannot be built at module load.
 * Production wires `(env) => createD1Store(env.db)`; tests pass
 * `() => createInMemoryStore(...)` and never touch Drizzle.
 *
 * `streamOptions` tunes the SSE tail loop; production uses the defaults, tests
 * pass small values so the stream ends quickly.
 */
export function createApp(
	resolveStore: (env: Env) => AlertStore,
	streamOptions: StreamOptions = DEFAULT_STREAM_OPTIONS,
) {
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

	// Strip the access_key shared secret from an org row for a client response.
	const toPublicOrganization = (org: Organization): PublicOrganization => {
		const { access_key: _access_key, ...pub } = org;
		return pub;
	};

	app.get('/org/:organizationKey', requireOrgAuth, async (c) => {
		// Never return access_key to the client.
		return c.json(toPublicOrganization(c.get('organization')));
	});

	app.put('/org/:organizationKey', requireOrgAuth, async (c) => {
		const organization = c.get('organization');

		// Coerce missing/blank fields to null so a cleared input falls back to the
		// app default rather than storing an empty string.
		const normalize = (value: unknown): string | null => {
			if (typeof value !== 'string') return null;
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : null;
		};

		let body: Record<string, unknown>;
		try {
			body = (await c.req.json()) as Record<string, unknown>;
		} catch {
			throw new HTTPException(400, { message: 'Invalid JSON body' });
		}

		const settings: OrgSettings = {
			default_city: normalize(body.default_city),
			default_state: normalize(body.default_state),
			tts_template: normalize(body.tts_template),
		};

		// Reject templates that reference unknown tokens, so a bad template can
		// never reach the generation pipeline.
		if (settings.tts_template !== null) {
			const { valid, unknownTokens } = validateTemplate(settings.tts_template);
			if (!valid) {
				throw new HTTPException(400, {
					message: `Unknown template token(s): ${unknownTokens.join(', ')}`,
				});
			}
		}

		await c.get('store').updateOrgSettings(organization.org_id, settings);

		// Return the updated public org so the client can refresh its view.
		return c.json(toPublicOrganization({ ...organization, ...settings }));
	});

	app.get('/org/:organizationKey/alerts', requireOrgAuth, async (c) => {
		const organization = c.get('organization');
		const alertsList = await c.get('store').latestAlerts(organization.org_id, 5);
		return c.json(alertsList);
	});

	app.get('/org/:organizationKey/alerts/stream', requireOrgAuth, async (c) => {
		const organization = c.get('organization');
		const store = c.get('store');

		// Resume point. The client echoes the last event id it saw as
		// `Last-Event-ID` on reconnect; that id is the alert's `timestamp`, so we
		// resume the tail from there and replay anything that landed during the
		// gap. On a fresh connection there is no header, so we start from "now" and
		// only stream alerts that arrive after connect — the current list is loaded
		// separately via GET .../alerts.
		const lastEventId = c.req.header('Last-Event-ID');
		const parsed = lastEventId !== undefined ? Number(lastEventId) : NaN;
		// Inclusive lower bound (epoch ms) for the next tail query.
		let cursor = Number.isFinite(parsed) ? parsed : Date.now();

		return streamSSE(c, async (stream) => {
			const deadline = Date.now() + streamOptions.maxMs;

			while (!stream.aborted && !stream.closed && Date.now() < deadline) {
				const fresh = await store.alertsSince(organization.org_id, cursor);
				for (const alert of fresh) {
					await stream.writeSSE({
						id: String(alert.timestamp),
						event: 'alert',
						data: JSON.stringify(alert),
					});
				}
				if (fresh.length > 0) {
					// Advance past the newest timestamp emitted so the next tail is
					// strictly newer. A same-ms alert inserted after this point is
					// still caught on the following tail (its timestamp equals the old
					// max, which is < cursor now) — acceptable: the intake pipeline
					// dedups within a window, and the client dedups by alert_id.
					const newest = fresh.reduce((max, a) => Math.max(max, a.timestamp), cursor);
					cursor = newest + 1;
				}

				// Heartbeat: keeps intermediaries from reaping an idle connection and
				// lets the client notice a dead link between alerts.
				await stream.writeSSE({ event: 'ping', data: '' });

				await stream.sleep(streamOptions.pollMs);
			}
		});
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
