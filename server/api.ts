import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { streamSSE } from 'hono/streaming';
import { timingSafeEqual } from 'hono/utils/buffer';

import type { Organization, PublicOrganization, OrgSettings } from '../shared/types';
import type { AlertStore } from './store';
import { validateTemplate } from '../shared/ttsTemplate';
import {
	isValidActionableWindow,
	MIN_ACTIONABLE_WINDOW_MINUTES,
	MAX_ACTIONABLE_WINDOW_MINUTES,
} from '../shared/actionableWindow';
import { isValidToneId, isValidMinuteOfDay } from '../shared/alertTones';
import { BUILD_ID, BUILD_ID_HEADER } from '../shared/build';
import {
	parseAllowedSenders,
	invalidSenderEntries,
	formatAllowedSenders,
	MAX_ALLOWED_SENDERS,
} from '../shared/senders';
import {
	parsePagerToneSets,
	formatPagerToneSets,
	MAX_PAGER_TONE_SETS,
} from '../shared/pagerTones';

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

	// Stamp every response with the build it came from, so a long-running
	// dashboard learns of a deploy from traffic it already makes — each stream
	// reconnect, each fallback poll — and reloads onto it.
	app.use('*', async (c, next) => {
		await next();
		c.res.headers.set(BUILD_ID_HEADER, BUILD_ID);
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

	// Strip the access_key shared secret and the admin-only caps from an org row
	// for a client response.
	const toPublicOrganization = (org: Organization): PublicOrganization => {
		const {
			access_key: _access_key,
			alert_cap_hourly: _alert_cap_hourly,
			alert_cap_monthly: _alert_cap_monthly,
			...pub
		} = org;
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

		// A missing or null window means "use the default"; anything else must be a
		// whole number of minutes in range, so a bad value is rejected here rather
		// than silently muting or spamming a station's dashboards.
		const window = body.actionable_window_minutes;
		if (window !== undefined && window !== null && !isValidActionableWindow(window)) {
			throw new HTTPException(400, {
				message: `actionable_window_minutes must be a whole number between ${MIN_ACTIONABLE_WINDOW_MINUTES} and ${MAX_ACTIONABLE_WINDOW_MINUTES}`,
			});
		}

		// Tones are built in, so a stored id must name one; null plays no tone.
		const alertTone = normalize(body.alert_tone);
		const quietAlertTone = normalize(body.quiet_alert_tone);
		for (const [field, tone] of [['alert_tone', alertTone], ['quiet_alert_tone', quietAlertTone]] as const) {
			if (tone !== null && !isValidToneId(tone)) {
				throw new HTTPException(400, { message: `Unknown ${field}: ${tone}` });
			}
		}

		// Quiet hours are both-or-neither: a window with one open end has no
		// meaning, and a zero-length one would never apply.
		const quietStart = body.quiet_hours_start ?? null;
		const quietEnd = body.quiet_hours_end ?? null;
		if (quietStart !== null || quietEnd !== null) {
			if (!isValidMinuteOfDay(quietStart) || !isValidMinuteOfDay(quietEnd)) {
				throw new HTTPException(400, {
					message: 'quiet_hours_start and quiet_hours_end must both be set, as whole minutes after midnight (0–1439)',
				});
			}
			if (quietStart === quietEnd) {
				throw new HTTPException(400, { message: 'Quiet hours must start and end at different times' });
			}
		}

		// Sender allowlist: one address or @domain per line. A bad entry is
		// rejected rather than dropped, since a silently lost entry would start
		// refusing that sender's pre-alerts.
		if (body.allowed_senders !== undefined && body.allowed_senders !== null && typeof body.allowed_senders !== 'string') {
			throw new HTTPException(400, { message: 'allowed_senders must be a string' });
		}
		const senders = parseAllowedSenders(body.allowed_senders as string | null | undefined);
		const badSenders = invalidSenderEntries(senders);
		if (badSenders.length > 0) {
			throw new HTTPException(400, {
				message: `Invalid allowed sender(s): ${badSenders.join(', ')} — use an address or @domain`,
			});
		}
		if (senders.length > MAX_ALLOWED_SENDERS) {
			throw new HTTPException(400, {
				message: `At most ${MAX_ALLOWED_SENDERS} allowed senders`,
			});
		}

		// Pager tone sets: one `<A Hz> <B Hz> [label]` per line. As with senders, a
		// bad line is rejected rather than dropped — a lost set would quietly stop
		// that page from cutting off pre-alerts.
		if (body.pager_tone_sets !== undefined && body.pager_tone_sets !== null && typeof body.pager_tone_sets !== 'string') {
			throw new HTTPException(400, { message: 'pager_tone_sets must be a string' });
		}
		const toneSets = parsePagerToneSets(body.pager_tone_sets as string | null | undefined);
		if (toneSets.errors.length > 0) {
			throw new HTTPException(400, { message: `Invalid pager tone set(s): ${toneSets.errors.join('; ')}` });
		}
		if (toneSets.sets.length > MAX_PAGER_TONE_SETS) {
			throw new HTTPException(400, { message: `At most ${MAX_PAGER_TONE_SETS} pager tone sets` });
		}

		const settings: OrgSettings = {
			default_city: normalize(body.default_city),
			default_state: normalize(body.default_state),
			tts_template: normalize(body.tts_template),
			actionable_window_minutes: isValidActionableWindow(window) ? window : null,
			alert_tone: alertTone,
			quiet_alert_tone: quietAlertTone,
			quiet_hours_start: quietStart as number | null,
			quiet_hours_end: quietEnd as number | null,
			allowed_senders: formatAllowedSenders(senders),
			pager_tone_sets: formatPagerToneSets(toneSets.sets),
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
		// `Last-Event-ID` on reconnect; that id is the alert's `updated_at`, so we
		// resume the tail from there and replay anything that landed during the
		// gap. On a fresh connection there is no header, so we start from "now" and
		// only stream changes that arrive after connect — the current list is loaded
		// separately via GET .../alerts.
		// An id is only a usable cursor if it parses as a positive epoch-ms
		// timestamp. A blank or junk header (`Number('')` is 0, which is finite)
		// must not fall through to 0 — that would replay the org's whole history.
		const lastEventId = c.req.header('Last-Event-ID')?.trim();
		const parsed = lastEventId ? Number(lastEventId) : NaN;
		// Inclusive lower bound (epoch ms) for the next tail query.
		let cursor = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();

		return streamSSE(c, async (stream) => {
			const deadline = Date.now() + streamOptions.maxMs;
			// alert_ids already emitted at exactly `cursor`. The cursor is an
			// `updated_at` and the tail is inclusive, so without this the boundary
			// alerts would repeat on every pass. Holding the cursor *at* the newest
			// change (rather than past it) is what lets a same-ms change written
			// after this tail still be picked up on the next one.
			let emittedAtCursor = new Set<string>();

			while (!stream.aborted && !stream.closed && Date.now() < deadline) {
				// Suppress only a row still sitting at the cursor it was sent at. A
				// revision moves `updated_at` forward, so it falls outside this test
				// and streams — matching on alert_id alone would strand it, since
				// nothing else can advance the cursor past it.
				const fresh = (await store.alertsSince(organization.org_id, cursor)).filter(
					(a) => !(a.updated_at === cursor && emittedAtCursor.has(a.alert_id)),
				);
				for (const alert of fresh) {
					await stream.writeSSE({
						id: String(alert.updated_at),
						event: 'alert',
						data: JSON.stringify(alert),
					});
				}
				if (fresh.length > 0) {
					const newest = fresh.reduce((max, a) => Math.max(max, a.updated_at), cursor);
					if (newest > cursor) {
						cursor = newest;
						emittedAtCursor = new Set();
					}
					for (const alert of fresh) {
						if (alert.updated_at === cursor) emittedAtCursor.add(alert.alert_id);
					}
				}

				// Heartbeat: keeps intermediaries from reaping an idle connection and
				// lets the client notice a dead link between alerts. It carries the
				// cursor as its id so the client has a resume point from the first
				// beat onwards — without one, `Last-Event-ID` stays unset until the
				// first alert arrives and every reconnect before that restarts the
				// tail at "now", losing whatever landed in the gap.
				await stream.writeSSE({ id: String(cursor), event: 'ping', data: '' });

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
