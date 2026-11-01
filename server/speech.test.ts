import { describe, it, expect } from 'vitest'

import { isPermanentApiError, isSpeakable, limitSpokenText, MAX_SPOKEN_TEXT_LENGTH } from './speech'

describe('limitSpokenText', () => {
	it('leaves text within the limit unchanged (whitespace collapsed)', () => {
		expect(limitSpokenText('Sick  Person.\n In Boone.')).toEqual({
			text: 'Sick Person. In Boone.',
			truncated: false,
		})
	})

	it('keeps text exactly at the limit', () => {
		const text = 'a'.repeat(MAX_SPOKEN_TEXT_LENGTH)
		expect(limitSpokenText(text)).toEqual({ text, truncated: false })
	})

	it('cuts at the last word boundary and closes with a period', () => {
		const result = limitSpokenText('one two three four', 12)
		expect(result).toEqual({ text: 'one two.', truncated: true })
		expect(result.text.length).toBeLessThanOrEqual(12)
	})

	it('drops trailing punctuation before the closing period', () => {
		expect(limitSpokenText('Fire, alarm, at the place', 14).text).toBe('Fire, alarm.')
	})

	it('hard-cuts a single word longer than the limit', () => {
		const result = limitSpokenText('x'.repeat(50), 10)
		expect(result).toEqual({ text: `${'x'.repeat(9)}.`, truncated: true })
	})

	it('never exceeds the default limit', () => {
		const result = limitSpokenText('word '.repeat(500))
		expect(result.truncated).toBe(true)
		expect(result.text.length).toBeLessThanOrEqual(MAX_SPOKEN_TEXT_LENGTH)
	})
})

describe('isSpeakable', () => {
	it.each(['Fire.', '911', 'Été'])('accepts %j', (text) => {
		expect(isSpeakable(text)).toBe(true)
	})
	it.each(['', '   ', '. , !'])('rejects %j', (text) => {
		expect(isSpeakable(text)).toBe(false)
	})
})

describe('isPermanentApiError', () => {
	it.each([400, 401, 403, 404, 413, 422])('treats %i as permanent', (status) => {
		expect(isPermanentApiError({ status })).toBe(true)
	})
	it.each([408, 429, 500, 502, 503])('treats %i as transient', (status) => {
		expect(isPermanentApiError({ status })).toBe(false)
	})
	it.each([new Error('network'), null, undefined, 'boom', { status: '400' }])(
		'treats %j (no numeric status) as transient',
		(err) => {
			expect(isPermanentApiError(err)).toBe(false)
		},
	)
})
