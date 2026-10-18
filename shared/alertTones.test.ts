import { describe, it, expect } from 'vitest'
import {
	ALERT_TONES,
	isValidToneId,
	isValidMinuteOfDay,
	isWithinQuietHours,
	parseTimeOfDay,
	formatTimeOfDay,
	selectTone,
} from './alertTones'

describe('tone registry', () => {
	it('has unique ids', () => {
		const ids = ALERT_TONES.map((t) => t.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('validates tone ids', () => {
		expect(isValidToneId('burst-fade')).toBe(true)
		expect(isValidToneId('purvis-soft')).toBe(true)
		expect(isValidToneId('nope')).toBe(false)
		expect(isValidToneId(null)).toBe(false)
	})
})

describe('quiet hours', () => {
	it('validates minute-of-day bounds', () => {
		expect(isValidMinuteOfDay(0)).toBe(true)
		expect(isValidMinuteOfDay(1439)).toBe(true)
		expect(isValidMinuteOfDay(1440)).toBe(false)
		expect(isValidMinuteOfDay(-1)).toBe(false)
		expect(isValidMinuteOfDay(1.5)).toBe(false)
		expect(isValidMinuteOfDay('60')).toBe(false)
	})

	it('handles a same-day window', () => {
		// 13:00–15:00
		expect(isWithinQuietHours(780, 900, 779)).toBe(false)
		expect(isWithinQuietHours(780, 900, 780)).toBe(true)
		expect(isWithinQuietHours(780, 900, 899)).toBe(true)
		expect(isWithinQuietHours(780, 900, 900)).toBe(false)
	})

	it('handles a window that wraps past midnight', () => {
		// 22:00–06:00
		expect(isWithinQuietHours(1320, 360, 1319)).toBe(false)
		expect(isWithinQuietHours(1320, 360, 1320)).toBe(true)
		expect(isWithinQuietHours(1320, 360, 0)).toBe(true)
		expect(isWithinQuietHours(1320, 360, 359)).toBe(true)
		expect(isWithinQuietHours(1320, 360, 360)).toBe(false)
	})

	it('treats unset or empty windows as no quiet hours', () => {
		expect(isWithinQuietHours(null, 360, 100)).toBe(false)
		expect(isWithinQuietHours(1320, null, 1400)).toBe(false)
		expect(isWithinQuietHours(600, 600, 600)).toBe(false)
	})

	it('parses and formats HH:MM', () => {
		expect(parseTimeOfDay('22:00')).toBe(1320)
		expect(parseTimeOfDay('6:05')).toBe(365)
		expect(parseTimeOfDay('24:00')).toBeNull()
		expect(parseTimeOfDay('12:60')).toBeNull()
		expect(parseTimeOfDay('')).toBeNull()
		expect(formatTimeOfDay(365)).toBe('06:05')
		expect(formatTimeOfDay(parseTimeOfDay('23:59')!)).toBe('23:59')
	})
})

describe('selectTone', () => {
	const settings = {
		alert_tone: 'burst-fade',
		quiet_alert_tone: 'purvis-soft',
		quiet_hours_start: 1320,
		quiet_hours_end: 360,
	}
	const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m)

	it('uses the normal tone outside quiet hours', () => {
		expect(selectTone(settings, at(12))?.id).toBe('burst-fade')
	})

	it('uses the quiet tone during quiet hours', () => {
		expect(selectTone(settings, at(23))?.id).toBe('purvis-soft')
		expect(selectTone(settings, at(5, 59))?.id).toBe('purvis-soft')
	})

	it('plays nothing during quiet hours when no quiet tone is set', () => {
		expect(selectTone({ ...settings, quiet_alert_tone: null }, at(2))).toBeUndefined()
	})

	it('plays nothing when no tone is set and there are no quiet hours', () => {
		expect(
			selectTone(
				{ alert_tone: null, quiet_alert_tone: null, quiet_hours_start: null, quiet_hours_end: null },
				at(12),
			),
		).toBeUndefined()
	})

	it('ignores an unknown stored tone id', () => {
		expect(selectTone({ ...settings, alert_tone: 'retired' }, at(12))).toBeUndefined()
	})
})
