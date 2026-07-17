/**
 * Expansion tables for turning terse CAD text into spoken words. The tokenizer
 * (`address.ts`) matches raw tokens against the KEYS here to classify them; the
 * template (`template.ts`) reads the VALUES to expand them for speech. Keys are
 * the uppercase forms as they appear in dispatch text.
 */

/** Street-type suffixes: `ST` -> `Street`. Unknown suffixes are left as spoken words. */
export const SUFFIXES: Record<string, string> = {
	ST: 'Street',
	AVE: 'Avenue',
	AV: 'Avenue',
	BLVD: 'Boulevard',
	DR: 'Drive',
	RD: 'Road',
	LN: 'Lane',
	CT: 'Court',
	PL: 'Place',
	CIR: 'Circle',
	TER: 'Terrace',
	TRL: 'Trail',
	PKWY: 'Parkway',
	HWY: 'Highway',
	WAY: 'Way',
	LOOP: 'Loop',
	PT: 'Point',
	SQ: 'Square',
};

/** Compass prefixes/suffixes: `W` -> `West`. */
export const DIRECTIONALS: Record<string, string> = {
	N: 'North',
	S: 'South',
	E: 'East',
	W: 'West',
	NE: 'Northeast',
	NW: 'Northwest',
	SE: 'Southeast',
	SW: 'Southwest',
};

/**
 * Nature-of-call codes that need semantic expansion. Codes not listed here fall
 * back to a light title-case (see `formatNature` in `template.ts`), which already
 * covers simple hyphenated codes like `FIRE-RESIDENCE` -> `Fire - Residence`.
 */
export const NATURE_DICTIONARY: Record<string, string> = {
	'MVC-PI': 'Motor Vehicle Collision with injury',
	'MVC-PD': 'Motor Vehicle Collision with property damage',
	'BREATHING PROBS': 'Breathing Problems',
	'BREATHING PROB': 'Breathing Problem',
	'CHEST PAIN/HEART': 'Chest Pain',
	'UNCON/FAINTING': 'Unconscious or Fainting',
	'SICK PERSON': 'Sick Person',
};
