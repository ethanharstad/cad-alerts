import { describe, it, expect } from 'vitest'

import { createInMemoryStore } from './store.fake'
import type { Alert, Organization } from '../shared/types'

const org: Organization = { org_id: 'o1', org_key: 'boone', access_key: 'k', name: 'Boone FD' }

function alert(id: string, orgId: string, timestamp: number): Alert {
	return {
		alert_id: id,
		organization: orgId,
		body: '',
		audio_url: `${id}.mp3`,
		timestamp,
		source: '',
		nature: '',
		address: '',
		city: '',
		latitude: null,
		longitude: null,
	}
}

// The in-memory adapter is load-bearing — both the route tests and (later) the
// pipeline tests trust it to behave like D1. These pin the behaviour the routes
// actually depend on, so the fake is a stated contract rather than an accident.
describe('createInMemoryStore', () => {
	it('findOrgByKey returns the seeded org and undefined for unknown keys', async () => {
		const store = createInMemoryStore({ orgs: [org] })
		expect(await store.findOrgByKey('boone')).toEqual(org)
		expect(await store.findOrgByKey('nope')).toBeUndefined()
	})

	it('latestAlerts returns newest first and respects the limit', async () => {
		const store = createInMemoryStore({
			alerts: [alert('a', 'o1', 100), alert('b', 'o1', 300), alert('c', 'o1', 200)],
		})
		const latest = await store.latestAlerts('o1', 2)
		expect(latest.map((a) => a.alert_id)).toEqual(['b', 'c'])
	})

	it('latestAlerts and findAlert scope by organization', async () => {
		const store = createInMemoryStore({
			alerts: [alert('a', 'o1', 100), alert('x', 'o2', 100)],
		})
		expect((await store.latestAlerts('o1', 5)).map((a) => a.alert_id)).toEqual(['a'])
		expect(await store.findAlert('o1', 'x')).toBeUndefined()
		expect(await store.findAlert('o1', 'a')).toBeDefined()
	})

	it('insertAlert adds to the store and is scoped on read', async () => {
		const store = createInMemoryStore()
		await store.insertAlert(alert('n', 'o1', 500))
		expect((await store.latestAlerts('o1', 5)).map((a) => a.alert_id)).toEqual(['n'])
	})
})
