/**
 * Template assembly: turns a parsed pre-alert into the spoken alert body with no
 * LLM in the loop. Address tokenization (`address.ts`) and number spelling
 * (`numbers.ts`) are combined here according to an `AddressTemplate`. The
 * template is a single global constant today, but is deliberately plain,
 * JSON-serializable data so it can later be stored per-organization (a DB
 * column parsed back into this same shape) without changing this code.
 */

import type { PreAlert } from './parse';
import { tokenizeAddress, type AddressTokens, type StreetRef } from './address';
import { spellNumber, spellOrdinal, type NumberStyle } from './numbers';
import { DIRECTIONALS, NATURE_DICTIONARY, SUFFIXES } from './dictionaries';

/** How the spoken alert is assembled from address tokens. */
export interface AddressTemplate {
	/** Pronunciation of the house number and hundred-block number. */
	streetNumberStyle: NumberStyle;
	/** Pronunciation of a numbered street in a plain address (6th, 230th). */
	streetNameStyle: NumberStyle;
	/** Pronunciation of a numbered street inside a hundred block. */
	hundredBlockStreetStyle: NumberStyle;
	/** How many times the address clause is repeated for clarity. */
	addressRepeat: number;
	/** Whether to speak apartment/unit detail. */
	includeApartment: boolean;
	/** Whether to speak a business name. */
	includeBusiness: boolean;
	/** Preposition spoken before the city, e.g. "in". */
	cityPrefix: string;
}

/**
 * The global template. Chosen to reproduce the historical prompt's spoken output:
 * paired street numbers ("nine fifteen"), the apartment dropped, the business
 * spoken, and the hundred-block street fully pronounced ("two hundred thirtieth").
 */
export const DEFAULT_ADDRESS_TEMPLATE: AddressTemplate = {
	streetNumberStyle: 'paired',
	streetNameStyle: 'paired',
	hundredBlockStreetStyle: 'spelled',
	addressRepeat: 2,
	includeApartment: false,
	includeBusiness: true,
	cityPrefix: 'in',
};

/** Title-case a run of words: "ADOBE LOUNGE" -> "Adobe Lounge". */
function titleCase(text: string): string {
	return text
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** Capitalize only the first character, leaving the rest untouched. */
function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Expand a nature-of-call code for speech: a dictionary hit wins; otherwise fall
 * back to a light title-case with hyphens spaced out, so `FIRE-RESIDENCE`
 * becomes "Fire - Residence" even without a dictionary entry.
 */
export function formatNature(nature: string): string {
	const key = nature.trim().toUpperCase();
	const mapped = NATURE_DICTIONARY[key];
	if (mapped) return mapped;
	return key
		.split(/\s*-\s*/)
		.map(titleCase)
		.join(' - ');
}

/** Render a street reference to lowercase spoken words. */
function renderStreetRef(ref: StreetRef, ordinalStyle: NumberStyle): string {
	const parts: string[] = [];
	if (ref.directional) parts.push(DIRECTIONALS[ref.directional].toLowerCase());
	for (const token of ref.name) {
		switch (token.kind) {
			case 'word':
				parts.push(token.text);
				break;
			case 'ordinal':
				parts.push(spellOrdinal(token.value, ordinalStyle));
				break;
			case 'number':
				parts.push(spellNumber(String(token.value), 'spelled'));
				break;
		}
	}
	if (ref.suffix) parts.push(SUFFIXES[ref.suffix].toLowerCase());
	return parts.filter(Boolean).join(' ');
}

/** Render the repeatable address clause (without business/apartment) for a set of tokens. */
function renderAddressClause(tokens: AddressTokens, template: AddressTemplate): string {
	switch (tokens.kind) {
		case 'street': {
			const parts: string[] = [];
			if (tokens.houseNumber) {
				parts.push(spellNumber(tokens.houseNumber, template.streetNumberStyle));
			} else if (tokens.houseNumberRaw) {
				parts.push(tokens.houseNumberRaw.toLowerCase());
			}
			const street = renderStreetRef(tokens, template.streetNameStyle);
			if (street) parts.push(street);
			return parts.join(' ');
		}
		case 'intersection': {
			const streets = tokens.streets.map((street) =>
				renderStreetRef(street, template.streetNameStyle),
			);
			let joined: string;
			if (streets.length <= 2) {
				joined = streets.join(' and ');
			} else {
				joined = `${streets.slice(0, -1).join(', ')}, and ${streets[streets.length - 1]}`;
			}
			return `intersection of ${joined}`;
		}
		case 'hundredBlock': {
			const block = spellNumber(tokens.block, template.streetNumberStyle);
			const street = renderStreetRef(tokens.street, template.hundredBlockStreetStyle);
			return `${block} block of ${street}`;
		}
		case 'raw':
			return tokens.text.toLowerCase();
	}
}

/**
 * Assemble the full spoken alert body for a pre-alert: the nature, the address
 * clause repeated per the template, any apartment/business detail, then the
 * city. Never throws — a degenerate address still yields nature + text + city.
 */
export function renderAlertText(
	preAlert: PreAlert,
	template: AddressTemplate = DEFAULT_ADDRESS_TEMPLATE,
): string {
	const tokens = tokenizeAddress(preAlert.address);
	const clause = renderAddressClause(tokens, template);

	const sentences: string[] = [formatNature(preAlert.nature)];

	const repeat = Math.max(1, template.addressRepeat);
	for (let i = 0; i < repeat; i++) {
		if (clause) sentences.push(clause);
	}

	if (template.includeApartment && tokens.kind === 'street' && tokens.apartment) {
		sentences.push(`apartment ${tokens.apartment.toLowerCase()}`);
	}

	if (template.includeBusiness && tokens.business) {
		sentences.push(titleCase(tokens.business));
	}

	sentences.push(`${template.cityPrefix} ${titleCase(preAlert.city)}`);

	return sentences.map(capitalizeFirst).join('. ') + '.';
}
