import { describe, it, expect } from 'vitest'

import { createApp } from './api'
import { createInMemoryStore } from './store.fake'
import type { Alert, Organization } from '../shared/types'

const orgRow: Organization = {
	org_id: 'o1',
	org_key: 'boone',
	access_key: 'abcdef',
	name: 'Boone FD',
	default_city: null,
	default_state: null,
	tts_template: null,
	actionable_window_minutes: null,
}

function alertRow(id: string, timestamp: number): Alert {
	return {
		alert_id: id,
		organization: 'o1',
		body: '',
		audio_url: `${id}.mp3`,
		timestamp,
		updated_at: timestamp,
		source: '',
		nature: '',
		address: '',
		city: '',
		latitude: null,
		longitude: null,
	}
}

// Build the app against an in-memory store seeded with the given orgs. The store
// is injected through createApp's resolver, so the routes run with no Drizzle
// and no D1 — the auth middleware and handlers are exercised through the store
// interface, the same seam production crosses.
function appWith(orgs: Organization[]) {
	// One store per app so writes persist across requests in a single test; the
	// org rows are cloned so a mutating PUT never leaks into the shared `orgRow`
	// literal used by other tests.
	const store = createInMemoryStore({ orgs: orgs.map((o) => ({ ...o })) })
	return createApp(() => store)
}

const env = {} as unknown as Env

describe('GET /api/org/:organizationKey authentication', () => {
	it('returns 401 when the Authorization header is missing', async () => {
		const res = await appWith([orgRow]).request('/api/org/boone', {}, env)
		expect(res.status).toBe(401)
	})

	it('returns 401 when the bearer token does not match access_key', async () => {
		const res = await appWith([orgRow]).request(
			'/api/org/boone',
			{ headers: { Authorization: 'Bearer wrong' } },
			env,
		)
		expect(res.status).toBe(401)
	})

	it('returns 200 without access_key when the token matches', async () => {
		const res = await appWith([orgRow]).request(
			'/api/org/boone',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({
			org_id: 'o1',
			org_key: 'boone',
			name: 'Boone FD',
			default_city: null,
			default_state: null,
			tts_template: null,
			actionable_window_minutes: null,
		})
		expect(body).not.toHaveProperty('access_key')
	})

	it('returns 404 when the organization does not exist', async () => {
		const res = await appWith([]).request(
			'/api/org/missing',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(404)
	})
})

describe('GET /api/org/:organizationKey/alerts authentication', () => {
	it('returns 401 without a valid token', async () => {
		const res = await appWith([orgRow]).request('/api/org/boone/alerts', {}, env)
		expect(res.status).toBe(401)
	})

	it('returns 200 with a valid token', async () => {
		const res = await appWith([orgRow]).request(
			'/api/org/boone/alerts',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([])
	})
})

describe('GET /api/org/:organizationKey/alerts/stream', () => {
	// Fast timing so the tail loop ends promptly and `res.text()` resolves.
	const streamOpts = { pollMs: 2, maxMs: 20 }

	function appWithAlerts(alerts: Alert[]) {
		const store = createInMemoryStore({ orgs: [{ ...orgRow }], alerts })
		return createApp(() => store, streamOpts)
	}

	it('returns 401 without a valid token', async () => {
		const res = await appWithAlerts([]).request('/api/org/boone/alerts/stream', {}, env)
		expect(res.status).toBe(401)
	})

	it('streams alerts at or after the Last-Event-ID cursor, and no earlier ones', async () => {
		const app = appWithAlerts([alertRow('a', 100), alertRow('b', 300), alertRow('c', 200)])
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef', 'Last-Event-ID': '200' } },
			env,
		)
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toContain('text/event-stream')

		const text = await res.text()
		expect(text).toContain('"alert_id":"c"') // timestamp 200, at the cursor
		expect(text).toContain('"alert_id":"b"') // timestamp 300, after the cursor
		expect(text).not.toContain('"alert_id":"a"') // timestamp 100, before the cursor
		// Each matching alert is emitted exactly once, not re-sent every tail.
		expect(text.match(/event: alert/g)?.length).toBe(2)
	})

	it('on a fresh connection (no Last-Event-ID) does not replay pre-existing alerts', async () => {
		const app = appWithAlerts([alertRow('old', 100)])
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(200)
		const text = await res.text()
		// Cursor starts at "now", so the historical alert is not streamed; only
		// heartbeats flow.
		expect(text).not.toContain('event: alert')
		expect(text).toContain('event: ping')
	})

	// The id of the last frame of the given event type, or undefined when that
	// type carried no id — mirrors how the client tracks `Last-Event-ID`.
	function lastIdOf(text: string, eventType: string): string | undefined {
		let id: string | undefined
		for (const frame of text.split('\n\n')) {
			const lines = frame.split('\n')
			if (!lines.includes(`event: ${eventType}`)) continue
			id = lines.find((l) => l.startsWith('id: '))?.slice('id: '.length)
		}
		return id
	}

	it('carries the cursor as the id on ping frames, so a reconnect before any alert has a resume point', async () => {
		const before = Date.now()
		const app = appWithAlerts([])
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		const pingId = lastIdOf(await res.text(), 'ping')
		// Without an id on the heartbeat the client's Last-Event-ID stays unset
		// until the first alert, and every reconnect until then restarts at "now".
		expect(pingId).toBeDefined()
		expect(Number(pingId)).toBeGreaterThanOrEqual(before)
	})

	it('resumes from a ping id without losing an alert that landed in the gap', async () => {
		const store = createInMemoryStore({ orgs: [{ ...orgRow }] })
		const app = createApp(() => store, streamOpts)

		const first = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		const pingId = lastIdOf(await first.text(), 'ping')!

		// The connection is now down. An alert lands at the cursor itself — the
		// tightest case, since the resumed tail's lower bound is inclusive.
		await store.insertAlert(alertRow('gap', Number(pingId)))

		const second = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef', 'Last-Event-ID': pingId } },
			env,
		)
		expect(await second.text()).toContain('"alert_id":"gap"')
	})

	it('streams a revision to an alert it has already sent', async () => {
		const store = createInMemoryStore({ orgs: [{ ...orgRow }] })
		// A longer cap than the other stream tests: this one drives two write →
		// read round-trips, and the reader is cancelled explicitly at the end.
		const app = createApp(() => store, { pollMs: 2, maxMs: 2000 })
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)

		const reader = res.body!.getReader()
		const decoder = new TextDecoder()
		let text = ''
		const readWhile = async (satisfied: () => boolean) => {
			while (!satisfied()) {
				const { value, done } = await reader.read()
				if (done) return
				text += decoder.decode(value, { stream: true })
			}
		}

		// Take the cursor from the first heartbeat rather than from a local clock
		// read — the handler sets it from its own `Date.now()`, so anything stamped
		// earlier would fall before the tail's lower bound and never stream.
		await readWhile(() => lastIdOf(text, 'ping') !== undefined)
		const cursor = Number(lastIdOf(text, 'ping'))

		await store.insertAlert({ ...alertRow('inc', cursor), nature: 'SICK PERSON' })
		await readWhile(() => text.includes('"nature":"SICK PERSON"'))

		// A follow-up email revises the incident. The alert keeps its original
		// `timestamp` (it holds its place in the recent list), so only `updated_at`
		// moves — which is exactly what the tail cursors on.
		await store.updateAlert({
			...alertRow('inc', cursor),
			nature: 'CARDIAC ARREST',
			updated_at: cursor + 1,
		})
		await readWhile(() => text.includes('"nature":"CARDIAC ARREST"'))
		await reader.cancel()

		expect(text).toContain('"nature":"CARDIAC ARREST"')
		// Same alert, so the client merges it in place rather than adding a row.
		expect(text.match(/"alert_id":"inc"/g)?.length).toBe(2)
	})

	it.each([
		['an empty', ''],
		['a whitespace', '  '],
		['a non-numeric', 'not-a-timestamp'],
		['a non-positive', '0'],
	])('treats %s Last-Event-ID as a fresh connection, not a replay from 0', async (_label, id) => {
		const app = appWithAlerts([alertRow('old', 100)])
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef', 'Last-Event-ID': id } },
			env,
		)
		expect(res.status).toBe(200)
		const text = await res.text()
		// A cursor of 0 would dump the org's entire history down the stream.
		expect(text).not.toContain('event: alert')
	})

	it('emits a same-millisecond alert inserted after it has already tailed that timestamp', async () => {
		const store = createInMemoryStore({ orgs: [{ ...orgRow }], alerts: [alertRow('b', 300)] })
		const app = createApp(() => store, streamOpts)
		const res = await app.request(
			'/api/org/boone/alerts/stream',
			{ headers: { Authorization: 'Bearer abcdef', 'Last-Event-ID': '300' } },
			env,
		)
		expect(res.status).toBe(200)

		// Read until the seeded alert has actually gone out, so the late insert is
		// guaranteed to land on a *later* tail at the same timestamp — the case a
		// cursor advanced past the newest timestamp would lose.
		const reader = res.body!.getReader()
		const decoder = new TextDecoder()
		let text = ''
		while (!text.includes('"alert_id":"b"')) {
			const { value, done } = await reader.read()
			if (done) break
			text += decoder.decode(value, { stream: true })
		}
		expect(text).toContain('"alert_id":"b"')

		await store.insertAlert(alertRow('b2', 300))

		for (;;) {
			const { value, done } = await reader.read()
			if (done) break
			text += decoder.decode(value, { stream: true })
		}
		expect(text).toContain('"alert_id":"b2"')
		// The already-emitted boundary alert is not re-sent on every tail.
		expect(text.match(/"alert_id":"b"/g)?.length).toBe(1)
	})
})

describe('PUT /api/org/:organizationKey settings', () => {
	const put = (app: ReturnType<typeof appWith>, key: string, headers: Record<string, string>, body: unknown) =>
		app.request(
			`/api/org/${key}`,
			{ method: 'PUT', headers, body: JSON.stringify(body) },
			env,
		)

	it('returns 401 without a valid token', async () => {
		const res = await put(appWith([orgRow]), 'boone', {}, { default_city: 'Boone' })
		expect(res.status).toBe(401)
	})

	it('returns 404 when the organization does not exist', async () => {
		const res = await put(
			appWith([]),
			'missing',
			{ Authorization: 'Bearer abcdef' },
			{ default_city: 'Boone' },
		)
		expect(res.status).toBe(404)
	})

	it('updates settings and returns the public org without access_key', async () => {
		const res = await put(
			appWith([orgRow]),
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ default_city: 'Boone', default_state: 'IA', tts_template: '{nature}. in {city}.' },
		)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({
			org_id: 'o1',
			org_key: 'boone',
			name: 'Boone FD',
			default_city: 'Boone',
			default_state: 'IA',
			tts_template: '{nature}. in {city}.',
			actionable_window_minutes: null,
		})
		expect(body).not.toHaveProperty('access_key')
	})

	it('coerces blank fields to null', async () => {
		const res = await put(
			appWith([orgRow]),
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ default_city: '   ', default_state: '', tts_template: '' },
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.default_city).toBeNull()
		expect(body.default_state).toBeNull()
		expect(body.tts_template).toBeNull()
	})

	it('rejects a template with unknown tokens', async () => {
		const res = await put(
			appWith([orgRow]),
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ tts_template: '{nature}. {bogus}.' },
		)
		expect(res.status).toBe(400)
	})

	it('stores an in-range actionable window', async () => {
		const res = await put(
			appWith([orgRow]),
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ actionable_window_minutes: 10 },
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ actionable_window_minutes: 10 })
	})

	it.each([
		['below the minimum', 0],
		['above the maximum', 61],
		['fractional', 2.5],
		['not a number', '10'],
	])('rejects an actionable window that is %s', async (_label, value) => {
		const res = await put(
			appWith([orgRow]),
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ actionable_window_minutes: value },
		)
		// Rejected rather than coerced: a silently clamped window would mute or
		// spam every dashboard in the organization.
		expect(res.status).toBe(400)
	})

	it('clears the actionable window when omitted or null, falling back to the default', async () => {
		const app = appWith([orgRow])
		await put(app, 'boone', { Authorization: 'Bearer abcdef' }, { actionable_window_minutes: 10 })

		const res = await put(
			app,
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ actionable_window_minutes: null },
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ actionable_window_minutes: null })
	})

	it('persists settings so a later GET reflects them', async () => {
		const app = appWith([orgRow])
		await put(
			app,
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{
				default_city: 'Ames',
				default_state: 'IA',
				tts_template: '{nature}.',
				actionable_window_minutes: 15,
			},
		)
		const res = await app.request(
			'/api/org/boone',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			org_id: 'o1',
			org_key: 'boone',
			name: 'Boone FD',
			default_city: 'Ames',
			default_state: 'IA',
			tts_template: '{nature}.',
			actionable_window_minutes: 15,
		})
	})
})
