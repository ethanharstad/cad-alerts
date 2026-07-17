import { describe, it, expect } from 'vitest'

import {
	processPreAlert,
	DEFAULT_DEDUP_WINDOW_MS,
	type PreAlertDeps,
	type StepRunner,
} from './pipeline'
import { createInMemoryStore } from './store.fake'
import { createFakeGenerator } from './generator.fake'
import { createInMemoryAudioStore } from './audio.fake'
import type { Alert, Organization } from '../shared/types'

const org: Organization = { org_id: 'o1', org_key: 'boone', access_key: 'k', name: 'Boone FD' }

// A pre-alert email addressed to the org's key, with a well-formed body.
const payload = {
	emailTo: 'boone@example.com',
	emailFrom: 'cad@example.com',
	emailText: 'SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018',
}

// A step runner that records step names in order and runs each closure inline —
// the production WorkflowStep memoizes results across retries; this just invokes.
function recordingStep() {
	const names: string[] = []
	const step: StepRunner = {
		do<T>(name: string, cb: () => Promise<T>): Promise<T> {
			names.push(name)
			return cb()
		},
	}
	return { step, names }
}

// Default dependency bundle; `overrides` swap in a specific store/generator/etc.
function deps(overrides: Partial<PreAlertDeps> = {}): PreAlertDeps {
	return {
		store: createInMemoryStore({ orgs: [org] }),
		generator: createFakeGenerator({ text: 'Sick Person. ...' }),
		audioStore: createInMemoryAudioStore(),
		nonRetryable: (message) => new Error(message),
		now: () => 1000,
		dedupWindowMs: DEFAULT_DEDUP_WINDOW_MS,
		...overrides,
	}
}

// A stored alert at the same location as `payload`, for seeding dedup tests.
function seededAlert(overrides: Partial<Alert> = {}): Alert {
	return {
		alert_id: 'inst-0',
		organization: 'o1',
		body: 'Sick Person. ...',
		audio_url: 'inst-0.mp3',
		timestamp: 1000,
		source: 'SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018',
		nature: 'SICK PERSON',
		address: '1704 HAWKEYE DR #APT 104',
		city: 'BOONE',
		latitude: 42.0368,
		longitude: -93.868018,
		...overrides,
	}
}

// The same incident re-dispatched with an updated nature (and matching audio).
const updatedPayload = {
	emailTo: 'boone@example.com',
	emailFrom: 'cad@example.com',
	emailText: 'CARDIAC ARREST | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018',
}

describe('processPreAlert', () => {
	it('records one alert for the resolved org on the happy path', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [org] })
		await processPreAlert(step, payload, 'inst-1', deps({ store }))

		const alerts = await store.latestAlerts('o1', 5)
		expect(alerts).toHaveLength(1)
		expect(alerts[0]).toMatchObject({
			alert_id: 'inst-1',
			organization: 'o1',
			body: 'Sick Person. ...',
			audio_url: 'inst-1.mp3',
			timestamp: 1000,
			source: payload.emailText,
			nature: 'SICK PERSON',
			address: '1704 HAWKEYE DR #APT 104',
			city: 'BOONE',
			latitude: 42.0368,
			longitude: -93.868018,
		})
	})

	it('runs the steps in a fixed, deterministic order', async () => {
		const { step, names } = recordingStep()
		await processPreAlert(step, payload, 'inst-1', deps())
		expect(names).toEqual([
			'Get Org',
			'Parse Email',
			'Generate Text',
			'Get Audio',
			'Upload Audio',
			'Save Record',
		])
	})

	it('signals non-retryable and stores nothing when the org is unknown', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [] })
		await expect(
			processPreAlert(step, payload, 'inst-1', deps({ store })),
		).rejects.toThrow(/not found/)
		expect(await store.latestAlerts('o1', 5)).toEqual([])
	})

	it('signals non-retryable and stores nothing when the email is malformed', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [org] })
		await expect(
			processPreAlert(step, { ...payload, emailText: 'garbage' }, 'inst-1', deps({ store })),
		).rejects.toThrow()
		expect(await store.latestAlerts('o1', 5)).toEqual([])
	})

	it('updates the existing alert in place when the same location recurs within the window', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [org], alerts: [seededAlert()] })
		await processPreAlert(
			step,
			updatedPayload,
			'inst-1',
			deps({
				store,
				generator: createFakeGenerator({ text: 'Cardiac Arrest. ...' }),
				now: () => 1000 + 60_000, // one minute later, well within the window
			}),
		)

		const alerts = await store.latestAlerts('o1', 5)
		expect(alerts).toHaveLength(1)
		expect(alerts[0]).toMatchObject({
			alert_id: 'inst-0', // preserved — not the new instance id
			timestamp: 1000, // original first-seen time kept
			nature: 'CARDIAC ARREST', // refreshed to the latest email
			body: 'Cardiac Arrest. ...',
			audio_url: 'inst-1.mp3', // points at the new audio
			source: updatedPayload.emailText,
		})
	})

	it('inserts a new alert when a different location recurs within the window', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({
			orgs: [org],
			alerts: [seededAlert({ address: '999 OTHER ST', city: 'AMES' })],
		})
		await processPreAlert(step, payload, 'inst-1', deps({ store, now: () => 1000 + 60_000 }))

		const alerts = await store.latestAlerts('o1', 5)
		expect(alerts).toHaveLength(2)
		expect(alerts.map((a) => a.alert_id).sort()).toEqual(['inst-0', 'inst-1'])
	})

	it('inserts a new alert when the same location recurs after the window', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [org], alerts: [seededAlert()] })
		await processPreAlert(
			step,
			updatedPayload,
			'inst-1',
			deps({
				store,
				dedupWindowMs: 30 * 60 * 1000,
				now: () => 1000 + 31 * 60 * 1000, // 31 minutes later — past the window
			}),
		)

		const alerts = await store.latestAlerts('o1', 5)
		expect(alerts).toHaveLength(2)
	})
})
