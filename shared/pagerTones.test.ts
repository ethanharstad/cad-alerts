import { describe, it, expect } from 'vitest'

import {
	parsePagerToneSets,
	formatPagerToneSets,
	describePagerToneSet,
} from './pagerTones'

describe('parsePagerToneSets', () => {
	it('reads one set per line, with optional labels', () => {
		expect(parsePagerToneSets('330.5 569.1 Station 1\n1092.4 832.5')).toEqual({
			sets: [
				{ a: 330.5, b: 569.1, label: 'Station 1' },
				{ a: 1092.4, b: 832.5, label: '' },
			],
			errors: [],
		})
	})

	it.each([
		['330.5, 569.1, Station 1'],
		['330.5/569.1 Station 1'],
		['  330.5   569.1 - Station 1  '],
		['330.5 569.1: Station 1'],
	])('accepts the separators people type: %s', (line) => {
		expect(parsePagerToneSets(line).sets).toEqual([{ a: 330.5, b: 569.1, label: 'Station 1' }])
	})

	it('treats null, empty and blank lines as no sets', () => {
		expect(parsePagerToneSets(null)).toEqual({ sets: [], errors: [] })
		expect(parsePagerToneSets('\n  \n')).toEqual({ sets: [], errors: [] })
	})

	it('drops an exact repeat of an A/B pair', () => {
		expect(parsePagerToneSets('330.5 569.1 One\n330.5 569.1 Two').sets).toHaveLength(1)
	})

	it('keeps sets that share one tone', () => {
		expect(parsePagerToneSets('330.5 569.1\n330.5 600.9').sets).toHaveLength(2)
	})

	it.each([
		['missing tone B', '330.5'],
		['not numbers', 'Station 1'],
		['below the band', '100 569.1'],
		['above the band', '330.5 4000'],
		['A and B too close', '330.5 335'],
		['an overlong label', `330.5 569.1 ${'x'.repeat(61)}`],
	])('reports a line with %s', (_label, line) => {
		const parsed = parsePagerToneSets(`1092.4 832.5\n${line}`)
		expect(parsed.sets).toHaveLength(1)
		expect(parsed.errors).toHaveLength(1)
	})
})

describe('formatPagerToneSets', () => {
	it('round-trips through parse', () => {
		const text = '330.5 569.1 Station 1\n1092.4 832.5'
		expect(formatPagerToneSets(parsePagerToneSets(text).sets)).toBe(text)
	})

	it('stores an empty list as null', () => {
		expect(formatPagerToneSets([])).toBeNull()
	})
})

describe('describePagerToneSet', () => {
	it('names a set by its label and tones, or tones alone', () => {
		expect(describePagerToneSet({ a: 330.5, b: 569.1, label: 'Station 1' })).toBe('Station 1 (330.5 / 569.1 Hz)')
		expect(describePagerToneSet({ a: 330.5, b: 569.1, label: '' })).toBe('330.5 / 569.1 Hz')
	})
})
