import { describe, it, expect } from 'vitest'
import {
	parseAllowedSenders,
	isValidSenderEntry,
	invalidSenderEntries,
	formatAllowedSenders,
	isSenderAllowed,
} from './senders'

describe('parseAllowedSenders', () => {
	it('splits on newlines and commas, trims, lower-cases, and dedups', () => {
		expect(parseAllowedSenders(' CAD@County.gov \n\n@x.org, cad@county.gov\r\n')).toEqual([
			'cad@county.gov',
			'@x.org',
		])
	})

	it('treats null and blank as an empty list', () => {
		expect(parseAllowedSenders(null)).toEqual([])
		expect(parseAllowedSenders('  \n ')).toEqual([])
	})
})

describe('entry validation', () => {
	it.each(['cad@county.gov', '@county.gov', 'a.b+c@mail.county.gov'])('accepts %s', (entry) => {
		expect(isValidSenderEntry(entry)).toBe(true)
	})

	it.each(['county.gov', 'county', '@county', 'cad@', 'a b@c.d', '@@c.d'])('rejects %s', (entry) => {
		expect(isValidSenderEntry(entry)).toBe(false)
	})

	it('lists only the invalid entries', () => {
		expect(invalidSenderEntries(['cad@county.gov', 'oops'])).toEqual(['oops'])
	})
})

describe('formatAllowedSenders', () => {
	it('joins with newlines and stores an empty list as null', () => {
		expect(formatAllowedSenders(['a@b.c', '@d.e'])).toBe('a@b.c\n@d.e')
		expect(formatAllowedSenders([])).toBeNull()
	})
})

describe('isSenderAllowed', () => {
	const allowed = ['cad@county.gov', '@dispatch.org']

	it('allows anyone when the list is empty', () => {
		expect(isSenderAllowed([], 'anyone@anywhere.net')).toBe(true)
		expect(isSenderAllowed([], '')).toBe(true)
	})

	it('matches exact addresses case-insensitively', () => {
		expect(isSenderAllowed(allowed, 'CAD@county.GOV')).toBe(true)
		expect(isSenderAllowed(allowed, 'other@county.gov')).toBe(false)
	})

	it('matches a domain entry exactly, not its subdomains or lookalikes', () => {
		expect(isSenderAllowed(allowed, 'anyone@dispatch.org')).toBe(true)
		expect(isSenderAllowed(allowed, 'anyone@mail.dispatch.org')).toBe(false)
		expect(isSenderAllowed(allowed, 'anyone@evildispatch.org')).toBe(false)
	})

	it('rejects a missing or malformed sender when a list is set', () => {
		expect(isSenderAllowed(allowed, '')).toBe(false)
		expect(isSenderAllowed(allowed, 'dispatch.org')).toBe(false)
		expect(isSenderAllowed(allowed, '@dispatch.org')).toBe(false)
	})
})
