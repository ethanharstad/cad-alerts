import { describe, it, expect } from 'vitest';
import type { PreAlert } from './parse';
import {
	renderAlertText,
	renderAlertTextFromString,
	formatNature,
	DEFAULT_ADDRESS_TEMPLATE,
	type AddressTemplate,
} from './template';
import { DEFAULT_TTS_TEMPLATE } from '../shared/ttsTemplate';

/** Build a PreAlert; coordinates are irrelevant to spoken text. */
function preAlert(nature: string, address: string, city: string): PreAlert {
	return { nature, address, city, latitude: 0, longitude: 0 };
}

describe('renderAlertText', () => {
	it('reproduces the historical prompt example with an apartment dropped', () => {
		expect(
			renderAlertText(preAlert('BACK PAIN', '1400 22nd St ##6', 'BOONE')),
		).toBe(
			'Back Pain. Fourteen hundred twenty second street. Fourteen hundred twenty second street. In Boone.',
		);
	});

	it('reproduces the historical prompt example with a directional and business', () => {
		expect(
			renderAlertText(
				preAlert('HEMORRHAGE', '915 W MAMIE EISENHOWER AVE; ADOBE LOUNGE', 'BOONE'),
			),
		).toBe(
			'Hemorrhage. Nine fifteen west mamie eisenhower avenue. Nine fifteen west mamie eisenhower avenue. Adobe Lounge. In Boone.',
		);
	});

	it('renders an intersection and expands a nature code', () => {
		expect(renderAlertText(preAlert('MVC-PI', '16TH ST & LINN ST', 'AMES'))).toBe(
			'Motor Vehicle Collision with injury. Intersection of sixteenth street and linn street. Intersection of sixteenth street and linn street. In Ames.',
		);
	});

	it('renders a hundred block with a fully spelled street', () => {
		expect(
			renderAlertText(preAlert('FIRE-RESIDENCE', '1900BLK 230TH ST', 'BOONE')),
		).toBe(
			'Fire - Residence. Nineteen hundred block of two hundred thirtieth street. Nineteen hundred block of two hundred thirtieth street. In Boone.',
		);
	});

	it('honors addressRepeat', () => {
		const template: AddressTemplate = { ...DEFAULT_ADDRESS_TEMPLATE, addressRepeat: 1 };
		expect(
			renderAlertText(preAlert('SICK PERSON', '1704 HAWKEYE DR', 'BOONE'), template),
		).toBe('Sick Person. Seventeen oh four hawkeye drive. In Boone.');
	});

	it('speaks the apartment when the template opts in', () => {
		const template: AddressTemplate = { ...DEFAULT_ADDRESS_TEMPLATE, includeApartment: true };
		expect(
			renderAlertText(preAlert('BACK PAIN', '1400 22nd St ##6', 'BOONE'), template),
		).toBe(
			'Back Pain. Fourteen hundred twenty second street. Fourteen hundred twenty second street. Apartment 6. In Boone.',
		);
	});

	it('applies the street-number style override', () => {
		const template: AddressTemplate = { ...DEFAULT_ADDRESS_TEMPLATE, streetNumberStyle: 'digits' };
		expect(
			renderAlertText(
				preAlert('HEMORRHAGE', '915 W MAMIE EISENHOWER AVE', 'BOONE'),
				template,
			),
		).toBe(
			'Hemorrhage. Nine one five west mamie eisenhower avenue. Nine one five west mamie eisenhower avenue. In Boone.',
		);
	});
});

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
