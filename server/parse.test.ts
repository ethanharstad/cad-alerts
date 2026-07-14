import { describe, it, expect } from 'vitest';
import { parseEmail, EmailParseError } from './parse';

describe('parseEmail', () => {
	it('parses a standard pre-alert body', () => {
		const result = parseEmail(
			'SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018',
		);
		expect(result).toEqual({
			nature: 'SICK PERSON',
			address: '1704 HAWKEYE DR #APT 104',
			city: 'BOONE',
			latitude: 42.0368,
			longitude: -93.868018,
		});
	});

	it('preserves address detail such as a business name after a semicolon', () => {
		const result = parseEmail(
			'SEIZURES | 1312 S STORY ST; SAINTS AVENUE CAFE:BOONE | 42.041368,-93.879049',
		);
		expect(result.nature).toBe('SEIZURES');
		expect(result.address).toBe('1312 S STORY ST; SAINTS AVENUE CAFE');
		expect(result.city).toBe('BOONE');
	});

	it('trims surrounding whitespace on every field', () => {
		const result = parseEmail(
			'  MVC-PI  |  16TH ST & LINN ST : AMES  |  42.0 , -93.6  ',
		);
		expect(result).toEqual({
			nature: 'MVC-PI',
			address: '16TH ST & LINN ST',
			city: 'AMES',
			latitude: 42.0,
			longitude: -93.6,
		});
	});

	it('uses the last segment for coordinates even with extra pipe segments', () => {
		const result = parseEmail(
			'FIRE-RESIDENCE | 1900BLK 230TH ST:BOONE | EXTRA INFO | 42.1,-93.9',
		);
		expect(result.latitude).toBe(42.1);
		expect(result.longitude).toBe(-93.9);
	});

	it.each([undefined, null, '', '   '])(
		'throws on empty input (%p)',
		(input) => {
			expect(() => parseEmail(input as string)).toThrow(EmailParseError);
			expect(() => parseEmail(input as string)).toThrow(/empty/i);
		},
	);

	it('throws when there are too few segments', () => {
		expect(() => parseEmail('SICK PERSON | 1704 HAWKEYE DR:BOONE')).toThrow(
			EmailParseError,
		);
	});

	it('throws when the nature is missing', () => {
		expect(() => parseEmail(' | 1704 HAWKEYE DR:BOONE | 42.0,-93.8')).toThrow(
			/nature/i,
		);
	});

	it('throws when the city separator is missing', () => {
		expect(() => parseEmail('SICK PERSON | 1704 HAWKEYE DR | 42.0,-93.8')).toThrow(
			/city/i,
		);
	});

	it('throws when the address is missing', () => {
		expect(() => parseEmail('SICK PERSON | :BOONE | 42.0,-93.8')).toThrow(
			/address/i,
		);
	});

	it('throws when coordinates are not a lat,lon pair', () => {
		expect(() =>
			parseEmail('SICK PERSON | 1704 HAWKEYE DR:BOONE | 42.0'),
		).toThrow(/coordinates/i);
	});

	it('throws when coordinates are not numeric', () => {
		expect(() =>
			parseEmail('SICK PERSON | 1704 HAWKEYE DR:BOONE | north,west'),
		).toThrow(/valid numbers/i);
	});
});
