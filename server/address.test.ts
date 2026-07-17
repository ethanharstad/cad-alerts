import { describe, it, expect } from 'vitest';
import { tokenizeAddress } from './address';

describe('tokenizeAddress', () => {
	it('parses a plain street address with an apartment', () => {
		expect(tokenizeAddress('1704 HAWKEYE DR #APT 104')).toEqual({
			kind: 'street',
			houseNumber: '1704',
			houseNumberRaw: null,
			apartment: '104',
			business: null,
			directional: null,
			name: [{ kind: 'word', text: 'hawkeye' }],
			suffix: 'DR',
		});
	});

	it('parses a directional and a business name', () => {
		expect(tokenizeAddress('915 W MAMIE EISENHOWER AVE; ADOBE LOUNGE')).toEqual({
			kind: 'street',
			houseNumber: '915',
			houseNumberRaw: null,
			apartment: null,
			business: 'ADOBE LOUNGE',
			directional: 'W',
			name: [
				{ kind: 'word', text: 'mamie' },
				{ kind: 'word', text: 'eisenhower' },
			],
			suffix: 'AVE',
		});
	});

	it('keeps a semicolon business name off the core address', () => {
		const tokens = tokenizeAddress('1312 S STORY ST; SAINTS AVENUE CAFE');
		expect(tokens.kind).toBe('street');
		expect(tokens.business).toBe('SAINTS AVENUE CAFE');
		expect(tokens).toMatchObject({ houseNumber: '1312', directional: 'S', suffix: 'ST' });
	});

	it('parses a two-street intersection', () => {
		expect(tokenizeAddress('16TH ST & LINN ST')).toEqual({
			kind: 'intersection',
			business: null,
			streets: [
				{ directional: null, name: [{ kind: 'ordinal', value: 16 }], suffix: 'ST' },
				{ directional: null, name: [{ kind: 'word', text: 'linn' }], suffix: 'ST' },
			],
		});
	});

	it('parses a three-street intersection', () => {
		const tokens = tokenizeAddress('MAIN ST & OAK ST & ELM ST');
		expect(tokens.kind).toBe('intersection');
		if (tokens.kind === 'intersection') {
			expect(tokens.streets).toHaveLength(3);
		}
	});

	it('parses a hundred block', () => {
		expect(tokenizeAddress('1900BLK 230TH ST')).toEqual({
			kind: 'hundredBlock',
			block: '1900',
			business: null,
			street: {
				directional: null,
				name: [{ kind: 'ordinal', value: 230 }],
				suffix: 'ST',
			},
		});
	});

	it('strips a "##" apartment marker', () => {
		const tokens = tokenizeAddress('1400 22nd St ##6');
		expect(tokens).toMatchObject({
			kind: 'street',
			houseNumber: '1400',
			apartment: '6',
			name: [{ kind: 'ordinal', value: 22 }],
			suffix: 'ST',
		});
	});

	it('keeps an unknown suffix as a spoken name word', () => {
		const tokens = tokenizeAddress('500 FOO BAR');
		expect(tokens).toMatchObject({
			kind: 'street',
			houseNumber: '500',
			suffix: null,
			name: [
				{ kind: 'word', text: 'foo' },
				{ kind: 'word', text: 'bar' },
			],
		});
	});

	it('handles a street with no house number', () => {
		expect(tokenizeAddress('MAIN ST')).toMatchObject({
			kind: 'street',
			houseNumber: null,
			houseNumberRaw: null,
			name: [{ kind: 'word', text: 'main' }],
			suffix: 'ST',
		});
	});

	it('captures a non-numeric leading token as a raw house number', () => {
		expect(tokenizeAddress('1704B HAWKEYE DR')).toMatchObject({
			kind: 'street',
			houseNumber: null,
			houseNumberRaw: '1704B',
			name: [{ kind: 'word', text: 'hawkeye' }],
			suffix: 'DR',
		});
	});

	it('falls back to a raw address when nothing is recognizable', () => {
		expect(tokenizeAddress('   ')).toEqual({ kind: 'raw', text: '', business: null });
	});
});
