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

	it('broadcasts on the chosen output from a match until the channel goes quiet', async () => {
		const graph = stubAudioGraph()
		let clock = 0
		vi.spyOn(performance, 'now').mockImplementation(() => clock)
		const changes: boolean[] = []
		let closedAt = -1
		const onMatch = vi.fn()
		const monitor = startPagerMonitor({
			deviceId: '',
			sets: [{ a: 330.5, b: 569.1, label: 'Station 1' }],
			onMatch,
			broadcast: {
				outputDeviceId: 'pa',
				onChange: (on) => {
					changes.push(on)
					if (!on) closedAt = graph.ctx.currentTime
				},
			},
		})
		await flush()
		expect(monitor.status).toBe('listening')
		expect(graph.ctx.setSinkId).toHaveBeenCalledWith('pa')
		// Shut until a page is heard, and running behind the input.
		expect(graph.broadcastGain().gain.value).toBe(0)
		expect(graph.delay().delayTime.value).toBe(2.5)

		const feed = (samples: Float32Array) => {
			for (let i = 0; i + CHUNK <= samples.length; i += CHUNK) {
				clock += (CHUNK / FS) * 1000
				graph.ctx.currentTime = clock / 1000
				graph.tap().port.onmessage!({ data: samples.slice(i, i + CHUNK) } as MessageEvent)
			}
		}
		feed(tone(330.5, 1000))
		feed(tone(569.1, 1500))
		expect(onMatch).toHaveBeenCalledOnce()
		expect(changes).toEqual([true])
		expect(graph.broadcastGain().gain.setTargetAtTime).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number))

		// Dispatch talking keeps it open; quiet afterwards closes it.
		feed(tone(1000, 4000, 0.1))
		expect(changes).toEqual([true])
		feed(new Float32Array(FS * 6))
		expect(changes).toEqual([true, false])
		// The fade-out waits for the delayed copy to finish playing.
		const fadeOut = graph.broadcastGain().gain.setTargetAtTime.mock.calls.at(-1)!
		expect(fadeOut[0]).toBe(0)
		expect(fadeOut[1]).toBeCloseTo(closedAt + 2.5)
		monitor.stop()
	})

	it('ends a broadcast in progress when stopped', async () => {
		const graph = stubAudioGraph()
		let clock = 0
		vi.spyOn(performance, 'now').mockImplementation(() => clock)
		const changes: boolean[] = []
		const monitor = startPagerMonitor({
			deviceId: '',
			sets: [{ a: 330.5, b: 569.1, label: '' }],
			onMatch: () => {},
			broadcast: { outputDeviceId: '', onChange: (on) => changes.push(on) },
		})
		await flush()
		// No device chosen: left on the system default.
		expect(graph.ctx.setSinkId).not.toHaveBeenCalled()
		const samples = new Float32Array([...tone(330.5, 1000), ...tone(569.1, 1500)])
		for (let i = 0; i + CHUNK <= samples.length; i += CHUNK) {
			clock += (CHUNK / FS) * 1000
			graph.tap().port.onmessage!({ data: samples.slice(i, i + CHUNK) } as MessageEvent)
		}
		expect(changes).toEqual([true])
		monitor.stop()
		expect(changes).toEqual([true, false])
		expect(graph.ctx.close).toHaveBeenCalled()
	})

	it('builds no broadcast path when the option is off', async () => {
		const graph = stubAudioGraph()
		const monitor = startPagerMonitor(baseOptions)
		await flush()
		expect(graph.delays).toHaveLength(0)
		expect(graph.ctx.setSinkId).not.toHaveBeenCalled()
		monitor.stop()
	})
})

const FS = 48_000
const CHUNK = 2048

function tone(hz: number, ms: number, amp = 0.5): Float32Array {
	const out = new Float32Array(Math.round((ms / 1000) * FS))
	for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / FS)
	return out
}

// Just enough Web Audio for the monitor to build its graph, recording the nodes
// so a test can reach the tap, the delay line and the broadcast gain.
function stubAudioGraph() {
	const track = { stop: vi.fn(), addEventListener: vi.fn() }
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
	vi.stubGlobal('navigator', {
		mediaDevices: { getUserMedia: async () => stream, enumerateDevices: async () => [] },
	})

	const param = () => ({ value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() })
	type FakeNode = { connect: (next: FakeNode) => FakeNode; gain: ReturnType<typeof param>; delayTime: ReturnType<typeof param> }
	const links = new Map<FakeNode, FakeNode>()
	const node = (): FakeNode => {
		const n: FakeNode = {
			connect: (next) => {
				links.set(n, next)
				return next
			},
			gain: param(),
			delayTime: param(),
		}
		return n
	}
	const delays: FakeNode[] = []
	const taps: { port: { onmessage: ((e: MessageEvent) => void) | null } }[] = []
	const ctx = {
		sampleRate: FS,
		currentTime: 0,
		state: 'running',
		destination: node(),
		audioWorklet: { addModule: async () => {} },
		createMediaStreamSource: () => node(),
		createGain: () => node(),
		createDelay: () => {
			const d = node()
			delays.push(d)
			return d
		},
		setSinkId: vi.fn(async () => {}),
		resume: async () => {},
		close: vi.fn(async () => {}),
		addEventListener: () => {},
	}
	vi.stubGlobal(
		'AudioContext',
		vi.fn(function () {
			return ctx
		}),
	)
	vi.stubGlobal(
		'AudioWorkletNode',
		vi.fn(function () {
			const tap = Object.assign(node(), { port: { onmessage: null } })
			taps.push(tap)
			return tap
		}),
	)
	return {
		ctx,
		delays,
		tap: () => taps[0]!,
		delay: () => delays[0]!,
		broadcastGain: () => links.get(delays[0]!)!,
	}
}
