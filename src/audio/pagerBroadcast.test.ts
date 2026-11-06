import { describe, it, expect } from 'vitest'

import { createPagerBroadcastGate } from './pagerBroadcast'

const LOUD = -20
const QUIET = -70

describe('createPagerBroadcastGate', () => {
	it('starts closed and ignores levels until a page is heard', () => {
		const gate = createPagerBroadcastGate({ silenceMs: 1000 })
		expect(gate.isOpen).toBe(false)
		expect(gate.level(LOUD, 0)).toBe(false)
		expect(gate.level(QUIET, 5000)).toBe(false)
		expect(gate.isOpen).toBe(false)
	})

	it('stays open while the channel is busy and closes after the silence', () => {
		const gate = createPagerBroadcastGate({ silenceMs: 1000, maxMs: 60_000 })
		gate.open(0)
		for (let t = 100; t <= 10_000; t += 100) expect(gate.level(LOUD, t)).toBe(false)
		expect(gate.isOpen).toBe(true)

		expect(gate.level(QUIET, 10_500)).toBe(false)
		expect(gate.level(QUIET, 10_900)).toBe(false)
		expect(gate.level(QUIET, 11_000)).toBe(true)
		expect(gate.isOpen).toBe(false)
		// Reported once.
		expect(gate.level(QUIET, 12_000)).toBe(false)
	})

	it('a short pause does not close it', () => {
		const gate = createPagerBroadcastGate({ silenceMs: 1000 })
		gate.open(0)
		gate.level(QUIET, 500)
		gate.level(QUIET, 900)
		gate.level(LOUD, 950)
		expect(gate.level(QUIET, 1800)).toBe(false)
		expect(gate.isOpen).toBe(true)
	})

	it('closes at the cap even on a channel that never goes quiet', () => {
		const gate = createPagerBroadcastGate({ silenceMs: 1000, maxMs: 5000 })
		gate.open(0)
		expect(gate.level(LOUD, 4900)).toBe(false)
		expect(gate.level(LOUD, 5000)).toBe(true)
	})

	it('a second page restarts both counts', () => {
		const gate = createPagerBroadcastGate({ silenceMs: 1000, maxMs: 5000 })
		gate.open(0)
		gate.level(LOUD, 4000)
		gate.open(4500)
		// Past the first page's cap, still within the second's.
		expect(gate.level(LOUD, 9400)).toBe(false)
		expect(gate.level(LOUD, 9500)).toBe(true)
	})

	it('can be closed by hand', () => {
		const gate = createPagerBroadcastGate()
		gate.open(0)
		gate.close()
		expect(gate.isOpen).toBe(false)
		expect(gate.level(QUIET, 60_000)).toBe(false)
	})
})
