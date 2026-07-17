import { describe, it, expect } from 'vitest';
import { spellNumber, spellOrdinal } from './numbers';

describe('spellNumber', () => {
	it.each([
		['123', 'one two three'],
		['1704', 'one seven zero four'],
		['5', 'five'],
		['0', 'zero'],
	])('spells %s as singular digits', (digits, expected) => {
		expect(spellNumber(digits, 'digits')).toBe(expected);
	});

	it.each([
		['5', 'five'],
		['42', 'forty two'],
		['100', 'one hundred'],
		['105', 'one oh five'],
		['123', 'one twenty three'],
		['320', 'three twenty'],
		['915', 'nine fifteen'],
		['1234', 'twelve thirty four'],
		['2003', 'twenty oh three'],
		['1202', 'twelve oh two'],
		['1400', 'fourteen hundred'],
		['1704', 'seventeen oh four'],
	])('spells %s as pairs', (digits, expected) => {
		expect(spellNumber(digits, 'paired')).toBe(expected);
	});

	it.each([
		['123', 'one hundred twenty three'],
		['1234', 'one thousand two hundred thirty four'],
		['2003', 'two thousand three'],
		['1400', 'one thousand four hundred'],
	])('spells %s fully', (digits, expected) => {
		expect(spellNumber(digits, 'spelled')).toBe(expected);
	});

	it('falls back to a full reading for 5+ digit numbers when paired', () => {
		expect(spellNumber('12345', 'paired')).toBe('twelve thousand three hundred forty five');
	});
});

describe('spellOrdinal', () => {
	it.each([
		[1, 'first'],
		[2, 'second'],
		[3, 'third'],
		[5, 'fifth'],
		[6, 'sixth'],
		[8, 'eighth'],
		[12, 'twelfth'],
		[16, 'sixteenth'],
		[20, 'twentieth'],
		[22, 'twenty second'],
		[230, 'two thirtieth'],
	])('spells the %sth street as a paired ordinal', (value, expected) => {
		expect(spellOrdinal(value, 'paired')).toBe(expected);
	});

	it('spells an ordinal fully when the style is spelled', () => {
		expect(spellOrdinal(230, 'spelled')).toBe('two hundred thirtieth');
	});
});
