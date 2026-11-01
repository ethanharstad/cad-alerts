import { describe, it, expect, vi } from 'vitest'

import {
	processPreAlert,
	DEFAULT_DEDUP_WINDOW_MS,
	AUDIO_STEP_CONFIG,
	TEXT_STEP_CONFIG,
	type PreAlertDeps,
	type StepRunner,
} from './pipeline'
import { createInMemoryStore } from './store.fake'
import { createFakeGenerator } from './generator.fake'
import { createInMemoryAudioStore } from './audio.fake'
import type { Alert, Organization } from '../shared/types'
import type { CapExceeded, CapReporter } from './caps'
import { MAX_SPEECH_FIELD_LENGTH, MAX_SPOKEN_TEXT_LENGTH } from './speech'

// A cap reporter that remembers every over-cap report.
function recordingCapReporter() {
	const reports: CapExceeded[] = []
	const reporter: CapReporter = {
		async capExceeded(event) {
			reports.push(event)
		},
	}
	return { reporter, reports }
}

const org: Organization = {
	org_id: 'o1',
	org_key: 'boone',
	access_key: 'k',
	name: 'Boone FD',
	default_city: null,
	default_state: null,
	tts_template: null,
	actionable_window_minutes: null,
	alert_tone: null,
	quiet_alert_tone: null,
	quiet_hours_start: null,
	quiet_hours_end: null,
	allowed_senders: null,
	alert_cap_hourly: null,
	alert_cap_monthly: null,
}

// A pre-alert email addressed to the org's key, with a well-formed body.
const payload = {
	emailTo: 'boone@example.com',
	emailFrom: 'cad@example.com',
	emailText: 'SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018',
}

// A step runner that records step names (and configs and results) in order and
// runs each closure inline — the production WorkflowStep memoizes results across
// retries and applies the config; this just invokes and ignores it.
function recordingStep() {
	const names: string[] = []
	const configs: Record<string, unknown> = {}
	const results: Record<string, unknown> = {}
	const step: StepRunner = {
		async do<T>(name: string, ...args: unknown[]): Promise<T> {
			names.push(name)
			const cb = args[args.length - 1] as () => Promise<T>
			if (args.length === 2) configs[name] = args[0]
			const result = await cb()
			results[name] = result
			return result
		},
	}
	return { step, names, configs, results }
}

// An error shaped like the OpenAI SDK's APIError (which carries `status`).
function apiError(status: number) {
	return Object.assign(new Error(`${status} status code`), { status })
}

// Default dependency bundle; `overrides` swap in a specific store/generator/etc.
function deps(overrides: Partial<PreAlertDeps> = {}): PreAlertDeps {
	return {
		store: createInMemoryStore({ orgs: [org] }),
		generator: createFakeGenerator({ text: 'Sick Person. ...' }),
		audioStore: createInMemoryAudioStore(),
		capReporter: recordingCapReporter().reporter,
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
		updated_at: 1000,
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
			'Check Duplicate',
			'Check Caps',
			'Generate Text',
			'Synthesize & Upload Audio',
			'Save Record',
		])
	})

	it('keeps audio bytes out of step state, returning only the object key', async () => {
		const { step, results } = recordingStep()
		await processPreAlert(step, payload, 'inst-1', deps())
		for (const value of Object.values(results)) {
			expect(value).not.toBeInstanceOf(ArrayBuffer)
		}
		expect(results['Synthesize & Upload Audio']).toBe('inst-1.mp3')
	})

	it('passes explicit retry/timeout configs to the text and audio steps', async () => {
		const { step, configs } = recordingStep()
		await processPreAlert(step, payload, 'inst-1', deps())
		expect(configs['Generate Text']).toEqual(TEXT_STEP_CONFIG)
		expect(configs['Synthesize & Upload Audio']).toEqual(AUDIO_STEP_CONFIG)
		expect(AUDIO_STEP_CONFIG.retries.backoff).toBe('exponential')
	})

	it('gives the audio step a timeout with headroom over the 40s OpenAI client timeout', () => {
		const seconds = Number.parseInt(AUDIO_STEP_CONFIG.timeout, 10)
		expect(seconds).toBeGreaterThanOrEqual(60)
	})

	it("passes the org's tts_template into text generation", async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({
			orgs: [{ ...org, tts_template: '{nature}. in {city}.' }],
		})
		const generator = createFakeGenerator({ text: 'Sick Person. In Boone.' })
		await processPreAlert(step, payload, 'inst-1', deps({ store, generator }))
		expect(generator.receivedTemplates).toEqual(['{nature}. in {city}.'])
	})

	it('passes null when the org has no tts_template', async () => {
		const { step } = recordingStep()
		const store = createInMemoryStore({ orgs: [org] })
		const generator = createFakeGenerator()
		await processPreAlert(step, payload, 'inst-1', deps({ store, generator }))
		expect(generator.receivedTemplates).toEqual([null])
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
			updated_at: 1000 + 60_000, // moved, so live listeners see the revision
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

	describe('sender allowlist', () => {
		it.each([
			['an exact address', 'cad@example.com'],
			['a domain', '@example.com'],
			['an address with different case', 'CAD@Example.COM'],
		])('accepts a sender matching %s', async (_label, entry) => {
			const { step } = recordingStep()
			const store = createInMemoryStore({ orgs: [{ ...org, allowed_senders: `other@x.org\n${entry}` }] })
			await processPreAlert(step, payload, 'inst-1', deps({ store }))
			expect(await store.latestAlerts('o1', 5)).toHaveLength(1)
		})

		it('rejects an unlisted sender non-retryably before any paid step', async () => {
			const { step, names } = recordingStep()
			const store = createInMemoryStore({ orgs: [{ ...org, allowed_senders: '@county.gov' }] })
			const generator = createFakeGenerator()
			const audioStore = createInMemoryAudioStore()
			const put = vi.spyOn(audioStore, 'put')
			const nonRetryable = vi.fn((message: string) => new Error(message))
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			try {
				await expect(
					processPreAlert(step, payload, 'inst-1', deps({ store, generator, audioStore, nonRetryable })),
				).rejects.toThrow(/not allowed/)
				expect(warn).toHaveBeenCalledWith('pre-alert sender rejected', expect.objectContaining({ emailFrom: 'cad@example.com' }))
			} finally {
				warn.mockRestore()
			}
			expect(nonRetryable).toHaveBeenCalledOnce()
			expect(names).toEqual(['Get Org'])
			expect(generator.receivedTemplates).toEqual([])
			expect(put).not.toHaveBeenCalled()
			expect(await store.latestAlerts('o1', 5)).toEqual([])
		})

		it('rejects a subdomain of a listed domain', async () => {
			const { step } = recordingStep()
			const store = createInMemoryStore({ orgs: [{ ...org, allowed_senders: '@example.com' }] })
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			try {
				await expect(
					processPreAlert(step, { ...payload, emailFrom: 'cad@mail.example.com' }, 'inst-1', deps({ store })),
				).rejects.toThrow(/not allowed/)
			} finally {
				warn.mockRestore()
			}
		})

		it('allows every sender when the list is empty', async () => {
			const { step } = recordingStep()
			const store = createInMemoryStore({ orgs: [{ ...org, allowed_senders: '' }] })
			await processPreAlert(step, { ...payload, emailFrom: 'anyone@anywhere.net' }, 'inst-1', deps({ store }))
			expect(await store.latestAlerts('o1', 5)).toHaveLength(1)
		})
	})

	describe('early duplicate skip', () => {
		it('stops an identical resend before text, audio, or any row change', async () => {
			const { step, names } = recordingStep()
			const seeded = seededAlert()
			const store = createInMemoryStore({ orgs: [org], alerts: [seeded] })
			const generator = createFakeGenerator()
			const audioStore = createInMemoryAudioStore()
			const put = vi.spyOn(audioStore, 'put')
			await processPreAlert(
				step,
				payload,
				'inst-1',
				deps({ store, generator, audioStore, now: () => 1000 + 60_000 }),
			)

			expect(names).toEqual(['Get Org', 'Parse Email', 'Check Duplicate'])
			expect(generator.receivedTemplates).toEqual([])
			expect(put).not.toHaveBeenCalled()
			expect(await store.latestAlerts('o1', 5)).toEqual([seeded])
		})

		it('still synthesizes a revision with a changed nature', async () => {
			const { step, names } = recordingStep()
			const store = createInMemoryStore({ orgs: [org], alerts: [seededAlert()] })
			const generator = createFakeGenerator({ text: 'Cardiac Arrest. ...' })
			await processPreAlert(
				step,
				updatedPayload,
				'inst-1',
				deps({ store, generator, now: () => 1000 + 60_000 }),
			)
			expect(names).toContain('Synthesize & Upload Audio')
			expect(generator.receivedTemplates).toHaveLength(1)
			expect((await store.latestAlerts('o1', 5))[0].nature).toBe('CARDIAC ARREST')
		})

		it('still synthesizes a revision with a changed location fix', async () => {
			const { step } = recordingStep()
			const store = createInMemoryStore({ orgs: [org], alerts: [seededAlert({ latitude: 42.1 })] })
			const generator = createFakeGenerator()
			await processPreAlert(step, payload, 'inst-1', deps({ store, generator, now: () => 1000 + 60_000 }))
			expect(generator.receivedTemplates).toHaveLength(1)
			expect((await store.latestAlerts('o1', 5))[0].latitude).toBe(42.0368)
		})

		it('treats an identical email after the dedup window as a new alert', async () => {
			const { step } = recordingStep()
			const store = createInMemoryStore({ orgs: [org], alerts: [seededAlert()] })
			await processPreAlert(step, payload, 'inst-1', deps({ store, now: () => 1000 + 31 * 60 * 1000 }))
			expect(await store.latestAlerts('o1', 5)).toHaveLength(2)
		})
	})

	describe('soft volume caps', () => {
		const HOUR = 60 * 60 * 1000
		const now = 100 * 24 * HOUR
		// Alerts elsewhere in town, so none of them dedups against `payload`.
		const others = (n: number, at: number) =>
			Array.from({ length: n }, (_, i) =>
				seededAlert({ alert_id: `old-${at}-${i}`, address: `${i} ELSEWHERE`, timestamp: at, updated_at: at }),
			)

		it('reports, but still delivers, an alert over the hourly cap', async () => {
			const { step } = recordingStep()
			const { reporter, reports } = recordingCapReporter()
			const store = createInMemoryStore({
				orgs: [{ ...org, alert_cap_hourly: 2 }],
				alerts: others(2, now - 10 * 60 * 1000),
			})
			await processPreAlert(step, payload, 'inst-1', deps({ store, capReporter: reporter, now: () => now }))

			expect(reports).toEqual([
				{ orgId: 'o1', orgKey: 'boone', alertId: 'inst-1', period: 'hourly', cap: 2, count: 3 },
			])
			expect((await store.latestAlerts('o1', 10)).map((a) => a.alert_id)).toContain('inst-1')
		})

		it('does not report an alert that lands exactly on the cap', async () => {
			const { step } = recordingStep()
			const { reporter, reports } = recordingCapReporter()
			const store = createInMemoryStore({
				orgs: [{ ...org, alert_cap_hourly: 3 }],
				alerts: others(2, now - 10 * 60 * 1000),
			})
			await processPreAlert(step, payload, 'inst-1', deps({ store, capReporter: reporter, now: () => now }))
			expect(reports).toEqual([])
		})

		it('only counts alerts inside each rolling window', async () => {
			const { step } = recordingStep()
			const { reporter, reports } = recordingCapReporter()
			const store = createInMemoryStore({
				orgs: [{ ...org, alert_cap_hourly: 1, alert_cap_monthly: 3 }],
				alerts: [
					...others(3, now - 2 * HOUR), // in the month, outside the hour
					...others(5, now - 31 * 24 * HOUR), // outside both
				],
			})
			await processPreAlert(step, payload, 'inst-1', deps({ store, capReporter: reporter, now: () => now }))
			expect(reports).toEqual([expect.objectContaining({ period: 'monthly', cap: 3, count: 4 })])
		})

		it('ignores a null or nonsensical cap', async () => {
			const { step } = recordingStep()
			const { reporter, reports } = recordingCapReporter()
			const store = createInMemoryStore({
				orgs: [{ ...org, alert_cap_hourly: 0, alert_cap_monthly: null }],
				alerts: others(5, now - 60_000),
			})
			await processPreAlert(step, payload, 'inst-1', deps({ store, capReporter: reporter, now: () => now }))
			expect(reports).toEqual([])
		})

		it('does not report an identical resend, which is skipped first', async () => {
			const { step } = recordingStep()
			const { reporter, reports } = recordingCapReporter()
			const store = createInMemoryStore({
				orgs: [{ ...org, alert_cap_hourly: 1 }],
				alerts: [seededAlert({ timestamp: now - 60_000, updated_at: now - 60_000 })],
			})
			await processPreAlert(step, payload, 'inst-1', deps({ store, capReporter: reporter, now: () => now }))
			expect(reports).toEqual([])
		})
	})

	describe('spoken text limits', () => {
		it('caps an oversized nature on its own so the location is still spoken', async () => {
			const { step } = recordingStep()
			const longNature = 'STRUCTURE FIRE '.repeat(30).trim()
			const generator = createFakeGenerator()
			const gen = vi.spyOn(generator, 'generateText')
			const store = createInMemoryStore({ orgs: [org] })
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			try {
				await processPreAlert(
					step,
					{ ...payload, emailText: `${longNature} | 1704 HAWKEYE DR:BOONE | 42.0368,-93.868018` },
					'inst-1',
					deps({ store, generator }),
				)
				expect(warn).toHaveBeenCalledWith(
					'pre-alert speech fields truncated',
					expect.objectContaining({ fields: ['nature'] }),
				)
			} finally {
				warn.mockRestore()
			}
			const spoken = gen.mock.calls[0][0]
			expect(spoken.nature.length).toBeLessThanOrEqual(MAX_SPEECH_FIELD_LENGTH.nature)
			expect(spoken.nature).toMatch(/FIRE$/)
			expect(spoken.address).toBe('1704 HAWKEYE DR')
			expect(spoken.city).toBe('BOONE')
			// The stored record keeps the full parsed field.
			expect((await store.latestAlerts('o1', 5))[0].nature).toBe(longNature)
		})

		it('does not touch fields within their caps', async () => {
			const { step } = recordingStep()
			const generator = createFakeGenerator()
			const gen = vi.spyOn(generator, 'generateText')
			await processPreAlert(step, payload, 'inst-1', deps({ generator }))
			expect(gen.mock.calls[0][0]).toMatchObject({
				nature: 'SICK PERSON',
				address: '1704 HAWKEYE DR #APT 104',
				city: 'BOONE',
			})
		})

		it('truncates over-long text at a word boundary before synthesis, and logs it', async () => {
			const { step } = recordingStep()
			const long = 'Fire alarm. ' + 'very long business name '.repeat(40)
			const generator = createFakeGenerator({ text: long })
			const synth = vi.spyOn(generator, 'synthesizeSpeech')
			const store = createInMemoryStore({ orgs: [org] })
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			try {
				await processPreAlert(step, payload, 'inst-1', deps({ store, generator }))
				expect(warn).toHaveBeenCalledWith(
					'spoken alert text truncated',
					expect.objectContaining({ alertId: 'inst-1', originalLength: long.length }),
				)
			} finally {
				warn.mockRestore()
			}
			const spoken = synth.mock.calls[0][0]
			expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_TEXT_LENGTH)
			expect(spoken).toMatch(/ name\.$/)
			expect((await store.latestAlerts('o1', 5))[0].body).toBe(spoken)
		})

		it('does not log or alter text within the limit', async () => {
			const { step } = recordingStep()
			const generator = createFakeGenerator({ text: 'Sick Person. In Boone.' })
			const synth = vi.spyOn(generator, 'synthesizeSpeech')
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			try {
				await processPreAlert(step, payload, 'inst-1', deps({ generator }))
				expect(warn).not.toHaveBeenCalled()
			} finally {
				warn.mockRestore()
			}
			expect(synth).toHaveBeenCalledWith('Sick Person. In Boone.')
		})

		it.each([[''], ['   '], ['. . .'], ['.'.repeat(5000)]])(
			'fails non-retryably on blank text %j without synthesizing',
			async (text) => {
				const { step } = recordingStep()
				const generator = createFakeGenerator({ text })
				const synth = vi.spyOn(generator, 'synthesizeSpeech')
				const nonRetryable = vi.fn((message: string) => new Error(message))
				const store = createInMemoryStore({ orgs: [org] })
				await expect(
					processPreAlert(step, payload, 'inst-1', deps({ store, generator, nonRetryable })),
				).rejects.toThrow(/blank \(\d+ chars/)
				expect(nonRetryable).toHaveBeenCalledOnce()
				// The message reports the length, never the (unbounded) text.
				expect(nonRetryable.mock.calls[0][0].length).toBeLessThan(100)
				expect(synth).not.toHaveBeenCalled()
				expect(await store.latestAlerts('o1', 5)).toEqual([])
			},
		)
	})

	describe('upstream API errors', () => {
		it.each([400, 404, 413, 422])(
			'treats a %i from speech synthesis as non-retryable and uploads nothing',
			async (status) => {
				const { step } = recordingStep()
				const generator = createFakeGenerator()
				vi.spyOn(generator, 'synthesizeSpeech').mockRejectedValue(apiError(status))
				const audioStore = createInMemoryAudioStore()
				const put = vi.spyOn(audioStore, 'put')
				const nonRetryable = vi.fn((message: string) => new Error(`NR: ${message}`))
				await expect(
					processPreAlert(step, payload, 'inst-1', deps({ generator, audioStore, nonRetryable })),
				).rejects.toThrow(/^NR: Upstream API rejected/)
				expect(nonRetryable).toHaveBeenCalledOnce()
				expect(put).not.toHaveBeenCalled()
			},
		)

		it.each([401, 403, 408, 429, 500, 503])('leaves a %i retryable', async (status) => {
			const { step } = recordingStep()
			const generator = createFakeGenerator()
			const original = apiError(status)
			vi.spyOn(generator, 'synthesizeSpeech').mockRejectedValue(original)
			const nonRetryable = vi.fn((message: string) => new Error(message))
			await expect(
				processPreAlert(step, payload, 'inst-1', deps({ generator, nonRetryable })),
			).rejects.toBe(original)
			expect(nonRetryable).not.toHaveBeenCalled()
		})

		it('leaves a network error (no status) retryable', async () => {
			const { step } = recordingStep()
			const generator = createFakeGenerator()
			const original = new TypeError('fetch failed')
			vi.spyOn(generator, 'synthesizeSpeech').mockRejectedValue(original)
			const nonRetryable = vi.fn((message: string) => new Error(message))
			await expect(
				processPreAlert(step, payload, 'inst-1', deps({ generator, nonRetryable })),
			).rejects.toBe(original)
			expect(nonRetryable).not.toHaveBeenCalled()
		})

		it('treats a 4xx from text generation as non-retryable', async () => {
			const { step } = recordingStep()
			const generator = createFakeGenerator()
			vi.spyOn(generator, 'generateText').mockRejectedValue(apiError(400))
			const synth = vi.spyOn(generator, 'synthesizeSpeech')
			const nonRetryable = vi.fn((message: string) => new Error(message))
			await expect(
				processPreAlert(step, payload, 'inst-1', deps({ generator, nonRetryable })),
			).rejects.toThrow(/Upstream API rejected/)
			expect(synth).not.toHaveBeenCalled()
		})
	})
})
