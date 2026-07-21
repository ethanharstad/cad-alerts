import { describe, it, expect } from 'vitest'

import { createApp } from './api'
import { createInMemoryStore } from './store.fake'
import type { Organization } from '../shared/types'

const orgRow: Organization = {
	org_id: 'o1',
	org_key: 'boone',
	access_key: 'abcdef',
	name: 'Boone FD',
	default_city: null,
	default_state: null,
	tts_template: null,
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

	it('persists settings so a later GET reflects them', async () => {
		const app = appWith([orgRow])
		await put(
			app,
			'boone',
			{ Authorization: 'Bearer abcdef' },
			{ default_city: 'Ames', default_state: 'IA', tts_template: '{nature}.' },
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
		})
	})
})
