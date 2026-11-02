import { describe, it, expect, vi, afterEach } from 'vitest'

import { startPagerMonitor } from './pagerMonitor'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// getUserMedia that the test resolves by hand, so it can stop the monitor while
// the input is still opening.
function stubSlowInput(devices: Partial<MediaDeviceInfo>[] = []) {
	const track = { stop: vi.fn(), addEventListener: vi.fn() }
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
	let grant: () => void = () => {}
	const getUserMedia = vi.fn(
		() =>
			new Promise((resolve) => {
				grant = () => resolve(stream)
			}),
	)
	const AudioContext = vi.fn()
	vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: async () => devices } })
	vi.stubGlobal('AudioContext', AudioContext)
	return { track, getUserMedia, AudioContext, grant: () => grant() }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const baseOptions = { deviceId: '', sets: [], onMatch: () => {} }

describe('startPagerMonitor', () => {
	it('returns a handle at once, starting', () => {
		stubSlowInput()
		const monitor = startPagerMonitor(baseOptions)
		expect(monitor.status).toBe('starting')
		monitor.stop()
	})

	it('releases an input that opens after it was stopped, and builds nothing', async () => {
		const input = stubSlowInput()
		const statuses: string[] = []
		const monitor = startPagerMonitor({ ...baseOptions, onStatus: (s) => statuses.push(s) })
		await flush()
		expect(input.getUserMedia).toHaveBeenCalledOnce()

		monitor.stop()
		input.grant()
		await flush()

		expect(input.track.stop).toHaveBeenCalled()
		expect(input.AudioContext).not.toHaveBeenCalled()
		expect(monitor.status).toBe('stopped')
		expect(statuses).toEqual(['stopped'])
	})

	it('never opens the input when stopped before it got that far', async () => {
		const input = stubSlowInput()
		startPagerMonitor(baseOptions).stop()
		await flush()
		expect(input.getUserMedia).not.toHaveBeenCalled()
	})

	it('follows a saved input whose id was re-issued, and reports the new id', async () => {
		const input = stubSlowInput([{ kind: 'audioinput', deviceId: 'new-id', label: 'USB Audio' }])
		const onDeviceIdChange = vi.fn()
		const monitor = startPagerMonitor({
			...baseOptions,
			deviceId: 'old-id',
			deviceLabel: 'USB Audio',
			onDeviceIdChange,
		})
		await flush()
		expect(onDeviceIdChange).toHaveBeenCalledWith('new-id')
		expect(input.getUserMedia).toHaveBeenCalledWith({
			audio: expect.objectContaining({ deviceId: { exact: 'new-id' } }),
		})
		monitor.stop()
	})

	it('reports a refused permission as unavailable', async () => {
		vi.stubGlobal('navigator', {
			mediaDevices: {
				enumerateDevices: async () => [],
				getUserMedia: async () => {
					throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
				},
			},
		})
		const statuses: [string, string | undefined][] = []
		const monitor = startPagerMonitor({ ...baseOptions, onStatus: (s, d) => statuses.push([s, d]) })
		await flush()
		expect(monitor.status).toBe('unavailable')
		expect(statuses[0]?.[1]).toMatch(/did not allow/)
	})
})
