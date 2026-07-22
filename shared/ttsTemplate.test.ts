import { describe, it, expect } from 'vitest'
import {
	DEFAULT_TTS_TEMPLATE,
	TTS_TOKENS,
	TOKEN_NAMES,
	parseTemplate,
	validateTemplate,
} from './ttsTemplate'

describe('token registry', () => {
	it('exposes the expected token names', () => {
		expect([...TOKEN_NAMES].sort()).toEqual(
			['address', 'apartment', 'business', 'city', 'nature'].sort(),
		)
	})

	it('keeps TOKEN_NAMES in sync with TTS_TOKENS', () => {
		expect([...TOKEN_NAMES].sort()).toEqual(TTS_TOKENS.map((t) => t.name).sort())
	})

	it('has a known default template', () => {
		expect(DEFAULT_TTS_TEMPLATE).toBe('{nature}. {address}. {address}. {business}. in {city}.')
		expect(validateTemplate(DEFAULT_TTS_TEMPLATE).valid).toBe(true)
	})
})

describe('parseTemplate', () => {
	it('splits literal text and tokens in order', () => {
		expect(parseTemplate('{nature}. in {city}.')).toEqual([
			{ type: 'token', name: 'nature', known: true },
			{ type: 'text', value: '. in ' },
			{ type: 'token', name: 'city', known: true },
			{ type: 'text', value: '.' },
		])
	})

	it('marks unknown tokens as not known', () => {
		expect(parseTemplate('{nature} {bogus}')).toEqual([
			{ type: 'token', name: 'nature', known: true },
			{ type: 'text', value: ' ' },
			{ type: 'token', name: 'bogus', known: false },
		])
	})

	it('handles a template with no tokens', () => {
		expect(parseTemplate('just words')).toEqual([{ type: 'text', value: 'just words' }])
	})

	it('handles an empty template', () => {
		expect(parseTemplate('')).toEqual([])
	})

	it('handles adjacent tokens with no text between them', () => {
		expect(parseTemplate('{nature}{city}')).toEqual([
			{ type: 'token', name: 'nature', known: true },
			{ type: 'token', name: 'city', known: true },
		])
	})
})

describe('validateTemplate', () => {
	it('accepts a template of only known tokens', () => {
		expect(validateTemplate('{nature} {address} {city}')).toEqual({
			valid: true,
			unknownTokens: [],
		})
	})

	it('reports unknown tokens de-duplicated in order', () => {
		expect(validateTemplate('{foo} {nature} {bar} {foo}')).toEqual({
			valid: false,
			unknownTokens: ['foo', 'bar'],
		})
	})
})
