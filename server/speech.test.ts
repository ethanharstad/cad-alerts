import { describe, it, expect } from 'vitest'

import {
	isPermanentApiError,
	isSpeakable,
	limitSpeechFields,
	limitSpokenText,
	truncateAtWord,
	MAX_SPEECH_FIELD_LENGTH,
	MAX_SPOKEN_TEXT_LENGTH,
} from './speech'

describe('limitSpokenText', () => {
	it('returns text within the limit exactly as given', () => {
		expect(limitSpokenText('Sick  Person.\n In Boone.')).toEqual({
			text: 'Sick  Person.\n In Boone.',
			truncated: false,
		})
	})

	it('collapses whitespace on over-long text before deciding to cut', () => {
		expect(limitSpokenText('one   two', 7)).toEqual({ text: 'one two', truncated: false })
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
	it.each([400, 404, 413, 422])('treats %i as permanent', (status) => {
		expect(isPermanentApiError({ status })).toBe(true)
	})
	it.each([401, 403, 408, 429, 500, 502, 503])('treats %i as transient', (status) => {
		expect(isPermanentApiError({ status })).toBe(false)
	})
	it.each([new Error('network'), null, undefined, 'boom', { status: '400' }])(
		'treats %j (no numeric status) as transient',
		(err) => {
			expect(isPermanentApiError(err)).toBe(false)
		},
	)
})

describe('truncateAtWord', () => {
	it('returns text that fits unchanged', () => {
		expect(truncateAtWord('one two', 7)).toBe('one two')
	})
	it('keeps a word that ends exactly at the limit', () => {
		expect(truncateAtWord('one two three', 7)).toBe('one two')
	})
	it('drops dangling punctuation', () => {
		expect(truncateAtWord('one; two three', 6)).toBe('one')
	})
	it('hard-cuts one long word', () => {
		expect(truncateAtWord('abcdefghij', 4)).toBe('abcd')
	})
})

describe('limitSpeechFields', () => {
	const base = { nature: 'SICK PERSON', address: '1704 HAWKEYE DR', city: 'BOONE', latitude: 1 }

	it('leaves normal fields alone and reports nothing', () => {
		expect(limitSpeechFields(base)).toEqual({ fields: base, truncated: [] })
	})

	it('caps each oversized field independently, keeping the others', () => {
		const long = { ...base, address: 'MAIN ST '.repeat(40), city: 'X'.repeat(100) }
		const { fields, truncated } = limitSpeechFields(long)
		expect(truncated).toEqual(['address', 'city'])
		expect(fields.nature).toBe('SICK PERSON')
		expect(fields.address.length).toBeLessThanOrEqual(MAX_SPEECH_FIELD_LENGTH.address)
		expect(fields.city.length).toBeLessThanOrEqual(MAX_SPEECH_FIELD_LENGTH.city)
		expect(fields.latitude).toBe(1)
	})

	it('drops a trailing business before the street when the address is cut', () => {
		const address = `1704 HAWKEYE DR;${' MEMORIAL HOSPITAL'.repeat(10)}`
		const { fields } = limitSpeechFields({ ...base, address })
		expect(fields.address.startsWith('1704 HAWKEYE DR;')).toBe(true)
	})

	it('does not mutate its input', () => {
		const input = { ...base, nature: 'FIRE '.repeat(40) }
		const copy = { ...input }
		limitSpeechFields(input)
		expect(input).toEqual(copy)
	})
})
