import { describe, it, expect, vi, afterEach } from 'vitest'

import { applyOutputDevice, listOutputDevices, resolveOutputDevice } from './outputDevice'

function stubDevices(devices: Partial<MediaDeviceInfo>[]) {
	vi.stubGlobal('navigator', {
		mediaDevices: { enumerateDevices: async () => devices },
	})
}

// resolveOutputDevice only looks once the browser can route audio at all.
function stubSinkSupport() {
	class FakeMediaElement {}
	;(FakeMediaElement.prototype as unknown as Record<string, unknown>).setSinkId = () => {}
	vi.stubGlobal('HTMLMediaElement', FakeMediaElement)
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('listOutputDevices', () => {
	it('keeps real outputs and drops inputs, aliases and hidden ids', async () => {
		stubDevices([
			{ kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
			{ kind: 'audiooutput', deviceId: 'communications', label: 'Communications' },
			{ kind: 'audiooutput', deviceId: '', label: '' },
			{ kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
			{ kind: 'audiooutput', deviceId: 'pa', label: 'Bay PA' },
		])
		expect(await listOutputDevices()).toEqual([{ deviceId: 'pa', label: 'Bay PA' }])
	})

	it('is empty when the browser has no media devices API', async () => {
		vi.stubGlobal('navigator', {})
		expect(await listOutputDevices()).toEqual([])
	})
})

describe('resolveOutputDevice', () => {
	it('passes the system default through', async () => {
		expect(await resolveOutputDevice('', '')).toBe('')
	})

	it('is unknown when the browser cannot route audio', async () => {
		vi.stubGlobal('HTMLMediaElement', class {})
		stubDevices([{ kind: 'audiooutput', deviceId: 'pa', label: 'Bay PA' }])
		expect(await resolveOutputDevice('pa', 'Bay PA')).toBeUndefined()
	})

	it('is unknown while device ids are withheld', async () => {
		stubSinkSupport()
		stubDevices([{ kind: 'audiooutput', deviceId: '', label: '' }])
		expect(await resolveOutputDevice('pa', 'Bay PA')).toBeUndefined()
	})

	it('keeps a saved id that is still connected', async () => {
		stubSinkSupport()
		stubDevices([{ kind: 'audiooutput', deviceId: 'pa', label: 'Bay PA' }])
		expect(await resolveOutputDevice('pa', 'Bay PA')).toBe('pa')
	})

	it('follows a re-issued id by its label', async () => {
		stubSinkSupport()
		stubDevices([
			{ kind: 'audiooutput', deviceId: 'new-pa', label: 'Bay PA' },
			{ kind: 'audiooutput', deviceId: 'desk', label: 'Desk Speakers' },
		])
		expect(await resolveOutputDevice('old-pa', 'Bay PA')).toBe('new-pa')
	})

	it('reports a missing device, including an ambiguous label', async () => {
		stubSinkSupport()
		stubDevices([
			{ kind: 'audiooutput', deviceId: 'a', label: 'USB Audio' },
			{ kind: 'audiooutput', deviceId: 'b', label: 'USB Audio' },
		])
		expect(await resolveOutputDevice('old', 'Bay PA')).toBeNull()
		expect(await resolveOutputDevice('old', 'USB Audio')).toBeNull()
	})
})

describe('applyOutputDevice', () => {
	it('routes to the chosen device', async () => {
		const setSinkId = vi.fn(async () => {})
		expect(await applyOutputDevice({ setSinkId, sinkId: '' }, 'pa')).toBe(true)
		expect(setSinkId).toHaveBeenCalledWith('pa')
	})

	it('falls back when the device is gone', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		const setSinkId = vi.fn(async () => {
			throw new DOMException('not found', 'NotFoundError')
		})
		expect(await applyOutputDevice({ setSinkId, sinkId: '' }, 'pa')).toBe(false)
	})

	it('falls back when the browser cannot route audio', async () => {
		expect(await applyOutputDevice({}, 'pa')).toBe(false)
		expect(await applyOutputDevice({}, '')).toBe(true)
	})

	it('leaves an element on the default alone', async () => {
		const setSinkId = vi.fn(async () => {})
		expect(await applyOutputDevice({ setSinkId, sinkId: '' }, '')).toBe(true)
		expect(setSinkId).not.toHaveBeenCalled()
	})

	it('moves an element back to the default', async () => {
		const setSinkId = vi.fn(async () => {})
		expect(await applyOutputDevice({ setSinkId, sinkId: 'pa' }, '')).toBe(true)
		expect(setSinkId).toHaveBeenCalledWith('')
	})
})
