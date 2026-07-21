import { describe, it, expect } from 'vitest';
import type { PreAlert } from './parse';
import { renderAlertTextFromString, formatNature } from './template';
import { DEFAULT_TTS_TEMPLATE } from '../shared/ttsTemplate';

/** Build a PreAlert; coordinates are irrelevant to spoken text. */
function preAlert(nature: string, address: string, city: string): PreAlert {
	return { nature, address, city, latitude: 0, longitude: 0 };
}

describe('renderAlertTextFromString', () => {
	it('reproduces the historical output with the default template (apartment dropped)', () => {
		expect(
			renderAlertTextFromString(preAlert('BACK PAIN', '1400 22nd St ##6', 'BOONE'), DEFAULT_TTS_TEMPLATE),
		).toBe(
			'Back Pain. Fourteen hundred twenty second street. Fourteen hundred twenty second street. In Boone.',
		);
	});

	it('speaks a business when present and collapses the empty business sentence otherwise', () => {
		expect(
			renderAlertTextFromString(
				preAlert('HEMORRHAGE', '915 W MAMIE EISENHOWER AVE; ADOBE LOUNGE', 'BOONE'),
				DEFAULT_TTS_TEMPLATE,
			),
		).toBe(
			'Hemorrhage. Nine fifteen west mamie eisenhower avenue. Nine fifteen west mamie eisenhower avenue. Adobe Lounge. In Boone.',
		);
	});

	it('renders an intersection with the default template', () => {
		expect(
			renderAlertTextFromString(preAlert('MVC-PI', '16TH ST & LINN ST', 'AMES'), DEFAULT_TTS_TEMPLATE),
		).toBe(
			'Motor Vehicle Collision with injury. Intersection of sixteenth street and linn street. Intersection of sixteenth street and linn street. In Ames.',
		);
	});

	it('renders a hundred block with the default template', () => {
		expect(
			renderAlertTextFromString(preAlert('FIRE-RESIDENCE', '1900BLK 230TH ST', 'BOONE'), DEFAULT_TTS_TEMPLATE),
		).toBe(
			'Fire - Residence. Nineteen hundred block of two hundred thirtieth street. Nineteen hundred block of two hundred thirtieth street. In Boone.',
		);
	});

	it('defaults to DEFAULT_TTS_TEMPLATE when none is given', () => {
		expect(renderAlertTextFromString(preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'))).toBe(
			renderAlertTextFromString(
				preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'),
				DEFAULT_TTS_TEMPLATE,
			),
		);
	});

	it('repeats the address once per {address} occurrence', () => {
		expect(
			renderAlertTextFromString(preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'), '{nature}. {address}. in {city}.'),
		).toBe('Sick Person. Seventeen oh four hawkeye drive. In Boone.');
	});

	it('speaks the apartment when the template includes {apartment}', () => {
		expect(
			renderAlertTextFromString(
				preAlert('BACK PAIN', '1400 22nd St ##6', 'BOONE'),
				'{nature}. {address}. {apartment}. in {city}.',
			),
		).toBe('Back Pain. Fourteen hundred twenty second street. Apartment 6. In Boone.');
	});

	it('renders unknown tokens as empty without throwing', () => {
		expect(
			renderAlertTextFromString(preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'), '{nature}. {bogus}. in {city}.'),
		).toBe('Sick Person. In Boone.');
	});

	it('does not substitute prototype-inherited names as tokens', () => {
		// {toString}/{constructor} must not surface JS internals; they are unknown
		// tokens and render as empty.
		expect(
			renderAlertTextFromString(
				preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'),
				'{nature}. {toString}{constructor}. in {city}.',
			),
		).toBe('Sick Person. In Boone.');
	});

	it('does not treat periods inside a token value as sentence breaks', () => {
		// The periods in "A.b.c." come from the {business} value, not the
		// template's free text, so they must not split (and re-capitalize) the
		// spoken sentence into "A. B. C. Towing".
		expect(
			renderAlertTextFromString(
				preAlert('HEMORRHAGE', '915 8TH ST; A.B.C. TOWING', 'BOONE'),
				'{nature}. {business}. in {city}.',
			),
		).toBe('Hemorrhage. A.b.c. Towing. In Boone.');
	});
});

describe('formatNature', () => {
	it('expands a known code via the dictionary', () => {
		expect(formatNature('MVC-PD')).toBe('Motor Vehicle Collision with property damage');
	});

	it('falls back to title case with spaced hyphens for unknown codes', () => {
		expect(formatNature('FIRE-VEHICLE')).toBe('Fire - Vehicle');
		expect(formatNature('HEMORRHAGE')).toBe('Hemorrhage');
	});
});
