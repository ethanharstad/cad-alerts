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
import { DEFAULT_TTS_TEMPLATE, parseTemplate } from '../shared/ttsTemplate';

/**
 * How a numbered address is pronounced. These are the only knobs the spoken
 * output still varies on; ordering, repetition, and free text now live in the
 * token template string (see `shared/ttsTemplate.ts` and
 * {@link renderAlertTextFromString}).
 */
export interface AddressTemplate {
	/** Pronunciation of the house number and hundred-block number. */
	streetNumberStyle: NumberStyle;
	/** Pronunciation of a numbered street in a plain address (6th, 230th). */
	streetNameStyle: NumberStyle;
	/** Pronunciation of a numbered street inside a hundred block. */
	hundredBlockStreetStyle: NumberStyle;
}

/**
 * The pronunciation defaults used when rendering the `{address}` fragment:
 * paired street numbers ("nine fifteen") and a fully pronounced hundred-block
 * street ("two hundred thirtieth"), matching the historical spoken output.
 */
export const DEFAULT_ADDRESS_TEMPLATE: AddressTemplate = {
	streetNumberStyle: 'paired',
	streetNameStyle: 'paired',
	hundredBlockStreetStyle: 'spelled',
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
 * The spoken value for each template token, given a parsed pre-alert. The
 * pronunciation choices (paired street numbers, spelled hundred-block streets)
 * are the historical defaults, reused from {@link DEFAULT_ADDRESS_TEMPLATE} so
 * the token STRING controls only ordering, repetition, and free text — not how
 * the address itself is spoken. Optional tokens (`business`, `apartment`) are
 * empty strings when absent; the empty sentence they leave behind collapses in
 * {@link renderAlertTextFromString}.
 */
function tokenFragments(preAlert: PreAlert): Record<string, string> {
	const tokens = tokenizeAddress(preAlert.address);
	return {
		nature: formatNature(preAlert.nature),
		address: renderAddressClause(tokens, DEFAULT_ADDRESS_TEMPLATE),
		city: preAlert.city ? titleCase(preAlert.city) : '',
		business: tokens.business ? titleCase(tokens.business) : '',
		apartment:
			tokens.kind === 'street' && tokens.apartment
				? `apartment ${tokens.apartment.toLowerCase()}`
				: '',
	};
}

/**
 * Assemble the spoken alert body from a token-based template string (see
 * `shared/ttsTemplate.ts`). Each recognized `{token}` is replaced by its spoken
 * value and everything else is literal free text. An unrecognized token renders
 * as empty and never throws — only tokens the shared registry knows are
 * substituted, so a name like `{toString}` can never surface a JS internal.
 *
 * Sentences are delimited only by "." characters in the template's FREE TEXT,
 * never by periods inside a token's spoken value — so a business like "St. Luke's
 * Hospital" stays one sentence. Each sentence is whitespace-collapsed, trimmed,
 * and capitalized, and empty sentences are dropped. That drop lets an absent
 * optional token (an empty `{business}`) disappear cleanly and reproduces the
 * historical per-sentence capitalization ("In Boone.").
 */
export function renderAlertTextFromString(
	preAlert: PreAlert,
	template: string = DEFAULT_TTS_TEMPLATE,
): string {
	const fragments = tokenFragments(preAlert);

	const sentences: string[] = [];
	let current = '';
	const flush = () => {
		const sentence = current.replace(/\s+/g, ' ').trim();
		if (sentence) sentences.push(capitalizeFirst(sentence));
		current = '';
	};

	for (const segment of parseTemplate(template)) {
		if (segment.type === 'token') {
			// Only known tokens are substituted; unknown names contribute nothing.
			current += segment.known ? fragments[segment.name] ?? '' : '';
			continue;
		}
		// A "." in literal free text ends the current sentence; periods that come
		// from a token's value (already appended above) do not.
		const parts = segment.value.split('.');
		for (let i = 0; i < parts.length; i++) {
			current += parts[i];
			if (i < parts.length - 1) flush();
		}
	}
	flush();

	return sentences.length > 0 ? `${sentences.join('. ')}.` : '';
}
