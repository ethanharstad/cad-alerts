import { describe, it, expect, vi } from 'vitest'

import { notifyPagerPreempt, onPagerPreempt } from './pagerPreempt'

describe('pagerPreempt', () => {
	it('notifies every listener until it unsubscribes', () => {
		const a = vi.fn()
		const b = vi.fn()
		const offA = onPagerPreempt(a)
		const offB = onPagerPreempt(b)
		notifyPagerPreempt()
		offA()
		notifyPagerPreempt()
		offB()
		expect(a).toHaveBeenCalledTimes(1)
		expect(b).toHaveBeenCalledTimes(2)
	})

	it('keeps notifying when one listener throws', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const after = vi.fn()
		const offBad = onPagerPreempt(() => {
			throw new Error('boom')
		})
		const offAfter = onPagerPreempt(after)
		notifyPagerPreempt()
		offBad()
		offAfter()
		expect(after).toHaveBeenCalledTimes(1)
	})
})
