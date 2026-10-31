import { describe, it, expect, vi } from 'vitest'
import { isActiveCap, createLoggingCapReporter } from './caps'

describe('isActiveCap', () => {
	it('accepts positive whole numbers only', () => {
		expect(isActiveCap(1)).toBe(true)
		expect(isActiveCap(500)).toBe(true)
		expect(isActiveCap(null)).toBe(false)
		expect(isActiveCap(0)).toBe(false)
		expect(isActiveCap(-5)).toBe(false)
		expect(isActiveCap(2.5)).toBe(false)
	})
})

describe('createLoggingCapReporter', () => {
	it('logs each over-cap event', async () => {
		const log = vi.fn()
		const event = { orgId: 'o1', orgKey: 'boone', alertId: 'a', period: 'hourly' as const, cap: 2, count: 3 }
		await createLoggingCapReporter(log).capExceeded(event)
		expect(log).toHaveBeenCalledWith('alert cap exceeded', event)
	})
})
