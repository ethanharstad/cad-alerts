import { describe, it, expect } from 'vitest'

import { createInMemoryStore } from './store.fake'
import type { Alert, Organization } from '../shared/types'

const org: Organization = { org_id: 'o1', org_key: 'boone', access_key: 'k', name: 'Boone FD' }

function alert(id: string, orgId: string, timestamp: number, overrides: Partial<Alert> = {}): Alert {
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
		...overrides,
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

	it('findRecentMatch matches same org+address+city within the window, newest first', async () => {
		const loc = { address: '1704 HAWKEYE DR', city: 'BOONE' }
		const store = createInMemoryStore({
			alerts: [
				alert('old', 'o1', 100, loc),
				alert('new', 'o1', 300, loc),
			],
		})
		const match = await store.findRecentMatch('o1', '1704 HAWKEYE DR', 'BOONE', 200)
		expect(match?.alert_id).toBe('new')
	})

	it('findRecentMatch ignores out-of-window, other-location, and other-org rows', async () => {
		const store = createInMemoryStore({
			alerts: [
				alert('stale', 'o1', 100, { address: 'A', city: 'BOONE' }), // before `since`
				alert('elsewhere', 'o1', 300, { address: 'B', city: 'BOONE' }), // different address
				alert('otherOrg', 'o2', 300, { address: 'A', city: 'BOONE' }), // different org
			],
		})
		expect(await store.findRecentMatch('o1', 'A', 'BOONE', 200)).toBeUndefined()
	})

	it('updateAlert overwrites mutable fields but preserves timestamp and identity', async () => {
		const store = createInMemoryStore({
			alerts: [alert('a', 'o1', 100, { nature: 'SICK PERSON', address: 'A', city: 'BOONE' })],
		})
		await store.updateAlert(
			alert('a', 'o1', 999, {
				nature: 'CARDIAC ARREST',
				body: 'new body',
				audio_url: 'b.mp3',
				source: 'new source',
				address: 'A',
				city: 'BOONE',
				latitude: 1,
				longitude: 2,
			}),
		)
		const updated = await store.findAlert('o1', 'a')
		expect(updated).toMatchObject({
			alert_id: 'a',
			timestamp: 100, // preserved, not the 999 passed in
			nature: 'CARDIAC ARREST',
			body: 'new body',
			audio_url: 'b.mp3',
			source: 'new source',
			latitude: 1,
			longitude: 2,
		})
	})

	it('updateAlert is a no-op when no row matches organization + alert_id', async () => {
		const store = createInMemoryStore({ alerts: [alert('a', 'o1', 100)] })
		await store.updateAlert(alert('a', 'o2', 100)) // right id, wrong org
		expect((await store.findAlert('o1', 'a'))?.timestamp).toBe(100)
	})
})
