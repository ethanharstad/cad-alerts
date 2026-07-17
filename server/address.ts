/**
 * Address tokenizer: turns the single raw address string that comes off a CAD
 * email into a structured, spellable shape. Pure and dependency-light (only the
 * recognition dictionaries), so it unit tests under node. The template layer
 * (`template.ts`) walks these tokens to build the spoken text — the tokenizer
 * itself makes no pronunciation choices.
 */

import { DIRECTIONALS, SUFFIXES } from './dictionaries';

/** One part of a street name. */
export type NameToken =
	/** A plain word, lowercased for natural TTS: "hawkeye", "linn". */
	| { kind: 'word'; text: string }
	/** A numbered street: 6TH -> 6, 230TH -> 230, 22ND -> 22. */
	| { kind: 'ordinal'; value: number }
	/** A cardinal number embedded in a name, e.g. HIGHWAY 30 -> 30. */
	| { kind: 'number'; value: number };

/** A single street reference; reused by plain addresses, intersections, and blocks. */
export interface StreetRef {
	/** Normalized directional key ("W", "NE"), or null. */
	directional: string | null;
	/** The street's name parts (may be empty for a bare numbered street). */
	name: NameToken[];
	/** Normalized suffix key ("ST", "DR"), or null when absent/unknown. */
	suffix: string | null;
}

/** A conventional `<number> <street>` address, optionally with unit/business. */
export interface StreetAddress extends StreetRef {
	kind: 'street';
	/** Raw digit run of the house number ("1704"), or null if none. */
	houseNumber: string | null;
	/** A leading token that has digits but is not purely numeric ("1704B"); spoken verbatim. */
	houseNumberRaw: string | null;
	/** Apartment/unit text with the "#"/"APT" marker stripped ("104", "6"), or null. */
	apartment: string | null;
	/** Business name that followed a ";", or null. */
	business: string | null;
}

/** Two or more streets joined by "&"/"and". */
export interface Intersection {
	kind: 'intersection';
	streets: StreetRef[];
	business: string | null;
}

/** A `<n>BLK <street>` hundred-block reference. */
export interface HundredBlock {
	kind: 'hundredBlock';
	/** Raw digit run of the block number ("1900"). */
	block: string;
	street: StreetRef;
	business: string | null;
}

/** Fallback for anything that matches no known shape; spoken as-is. */
export interface RawAddress {
	kind: 'raw';
	text: string;
	business: string | null;
}

export type AddressTokens = StreetAddress | Intersection | HundredBlock | RawAddress;

/** Split a business name off a ";"-suffixed address. Returns the core and the business (or null). */
function splitBusiness(address: string): { core: string; business: string | null } {
	const idx = address.indexOf(';');
	if (idx === -1) return { core: address.trim(), business: null };
	const core = address.slice(0, idx).trim();
	const business = address.slice(idx + 1).trim();
	return { core, business: business || null };
}

/** Collapse runs of whitespace and split into non-empty tokens. */
function words(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

/** Classify a single street-name token. */
function nameToken(token: string): NameToken {
	const ordinal = /^(\d+)(st|nd|rd|th)$/i.exec(token);
	if (ordinal) return { kind: 'ordinal', value: Number(ordinal[1]) };
	if (/^\d+$/.test(token)) return { kind: 'number', value: Number(token) };
	return { kind: 'word', text: token.toLowerCase() };
}

/**
 * Parse a street reference from its tokens: an optional leading directional, an
 * optional trailing known suffix, and the name parts in between. An unknown
 * trailing token is kept as a name word rather than dropped.
 */
function parseStreetRef(tokens: string[]): StreetRef {
	let directional: string | null = null;
	let suffix: string | null = null;
	const rest = [...tokens];

	if (rest.length > 1) {
		const head = rest[0].toUpperCase();
		if (head in DIRECTIONALS) {
			directional = head;
			rest.shift();
		}
	}
	if (rest.length > 1) {
		const tail = rest[rest.length - 1].toUpperCase();
		if (tail in SUFFIXES) {
			suffix = tail;
			rest.pop();
		}
	}

	return { directional, name: rest.map(nameToken), suffix };
}

/**
 * Tokenize a raw CAD address string into a structured, spellable shape. Never
 * throws: anything unrecognized falls back to a `raw` token spoken verbatim.
 */
export function tokenizeAddress(address: string): AddressTokens {
	const { core, business } = splitBusiness(address);

	// Intersection: two or more streets joined by "&" or "and".
	if (/(^|\s)(&|and)(\s|$)/i.test(core)) {
		const parts = core
			.split(/\s*(?:&|\band\b)\s*/i)
			.map((part) => part.trim())
			.filter(Boolean);
		if (parts.length >= 2) {
			return {
				kind: 'intersection',
				streets: parts.map((part) => parseStreetRef(words(part))),
				business,
			};
		}
	}

	// Hundred block: "1900BLK 230TH ST".
	const block = /^(\d+)\s*BLK\b\s*(.*)$/i.exec(core);
	if (block && block[2].trim()) {
		return {
			kind: 'hundredBlock',
			block: block[1],
			street: parseStreetRef(words(block[2])),
			business,
		};
	}

	// Plain street address: strip a trailing apartment/unit marker, then read a
	// leading house number and the street reference.
	let apartment: string | null = null;
	let withoutApt = core;
	const apt = /#+\s*(?:APT|UNIT|STE|#)?\s*(.+)$/i.exec(core);
	if (apt) {
		apartment = apt[1].trim() || null;
		withoutApt = core.slice(0, apt.index).trim();
	}

	const tokens = words(withoutApt);
	if (tokens.length > 0) {
		let houseNumber: string | null = null;
		let houseNumberRaw: string | null = null;
		let streetTokens = tokens;
		if (/^\d+$/.test(tokens[0])) {
			houseNumber = tokens[0];
			streetTokens = tokens.slice(1);
		} else if (/^\d/.test(tokens[0])) {
			houseNumberRaw = tokens[0];
			streetTokens = tokens.slice(1);
		}
		if (houseNumber || houseNumberRaw || streetTokens.length > 0) {
			return {
				kind: 'street',
				houseNumber,
				houseNumberRaw,
				apartment,
				business,
				...parseStreetRef(streetTokens),
			};
		}
	}

	return { kind: 'raw', text: core, business };
}
