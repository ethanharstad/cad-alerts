import { describe, it, expect } from 'vitest'

import { createApp } from './api'
import { createInMemoryStore } from './store.fake'
import type { Organization } from '../shared/types'

const orgRow: Organization = { org_id: 'o1', org_key: 'boone', access_key: 'abcdef', name: 'Boone FD' }

// Build the app against an in-memory store seeded with the given orgs. The store
// is injected through createApp's resolver, so the routes run with no Drizzle
// and no D1 — the auth middleware and handlers are exercised through the store
// interface, the same seam production crosses.
function appWith(orgs: Organization[]) {
	return createApp(() => createInMemoryStore({ orgs }))
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
		expect(body).toEqual({ org_id: 'o1', org_key: 'boone', name: 'Boone FD' })
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
