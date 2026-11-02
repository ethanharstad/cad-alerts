import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'

import { useDevicePicker } from './useDevicePicker'

afterEach(() => {
	vi.unstubAllGlobals()
})

function picker(devices: { deviceId: string; label: string }[], savedId = '', savedLabel = '') {
	const deviceId = ref(savedId)
	const label = ref(savedLabel)
	const p = useDevicePicker({
		list: async () => devices,
		deviceId,
		label,
		deniedMessage: 'denied',
		emptyMessage: 'empty',
	})
	return { ...p, deviceId, label }
}

describe('useDevicePicker', () => {
	it('lists devices and follows a re-issued id by its label', async () => {
		const p = picker([{ deviceId: 'new', label: 'USB Audio' }], 'old', 'USB Audio')
		await p.refresh()
		expect(p.devices.value).toHaveLength(1)
		expect(p.deviceId.value).toBe('new')
		expect(p.savedMissing.value).toBe(false)
	})

	it('flags a saved device that is gone', async () => {
		const p = picker([{ deviceId: 'a', label: 'A' }], 'gone', 'Gone')
		await p.refresh()
		expect(p.savedMissing.value).toBe(true)
	})

	it('select stores the id and label, and clearing forgets the label', () => {
		const p = picker([], '', '')
		p.devices.value = [{ deviceId: 'a', label: 'Line In' }]
		p.select('a')
		expect([p.deviceId.value, p.label.value]).toEqual(['a', 'Line In'])
		p.select('')
		expect([p.deviceId.value, p.label.value]).toEqual(['', ''])
	})

	it('explains a refused permission, and an empty list', async () => {
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => { throw new Error('no') } } })
		const denied = picker([])
		await denied.find()
		expect(denied.message.value).toBe('denied')

		vi.stubGlobal('navigator', {
			mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
		})
		const empty = picker([])
		await empty.find()
		expect(empty.message.value).toBe('empty')
	})
})
