import { describe, it, expect, vi, beforeEach } from 'vitest'

const orgRow = { org_id: 'o1', org_key: 'boone', access_key: 'abcdef', name: 'Boone FD' }

// Controls what the mocked org lookup returns for a given test.
let orgResult: typeof orgRow | undefined

// Mock the Drizzle D1 driver so the routes run without a real database. Every
// builder method is chainable; `.get()` resolves the org lookup and the alerts
// list query (`.limit()`) resolves to an empty array — enough to exercise the
// auth middleware.
vi.mock('drizzle-orm/d1', () => ({
	drizzle: () => {
		const chain: Record<string, unknown> = {
			select: () => chain,
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve([]),
			get: () => Promise.resolve(orgResult),
		}
		return chain
	},
}))

import { app } from './api'

const env = { db: {} } as unknown as Env

beforeEach(() => {
	orgResult = orgRow
})

describe('GET /api/org/:organizationKey authentication', () => {
	it('returns 401 when the Authorization header is missing', async () => {
		const res = await app.request('/api/org/boone', {}, env)
		expect(res.status).toBe(401)
	})

	it('returns 401 when the bearer token does not match access_key', async () => {
		const res = await app.request(
			'/api/org/boone',
			{ headers: { Authorization: 'Bearer wrong' } },
			env,
		)
		expect(res.status).toBe(401)
	})

	it('returns 200 without access_key when the token matches', async () => {
		const res = await app.request(
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
		orgResult = undefined
		const res = await app.request(
			'/api/org/missing',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(404)
	})
})

describe('GET /api/org/:organizationKey/alerts authentication', () => {
	it('returns 401 without a valid token', async () => {
		const res = await app.request('/api/org/boone/alerts', {}, env)
		expect(res.status).toBe(401)
	})

	it('returns 200 with a valid token', async () => {
		const res = await app.request(
			'/api/org/boone/alerts',
			{ headers: { Authorization: 'Bearer abcdef' } },
			env,
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([])
	})
})
