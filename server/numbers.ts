/**
 * Number-to-words for spoken alerts. Pure, dependency-free, so it unit tests
 * under node and never reaches for the LLM. The address-to-speech path used to
 * ask the model to pronounce numbers; these functions replace that with
 * deterministic spelling selectable by the template.
 */

/** How a street/house number is pronounced. */
export type NumberStyle =
	/** Each digit alone: 123 -> "one two three". */
	| 'digits'
	/** Radio-style pairs: 123 -> "one twenty three", 2003 -> "twenty oh three". */
	| 'paired'
	/** Fully pronounced cardinal: 123 -> "one hundred twenty three". */
	| 'spelled';

const ONES = [
	'zero', 'one', 'two', 'three', 'four',
	'five', 'six', 'seven', 'eight', 'nine',
];

const TEENS = [
	'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
	'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
	'', '', 'twenty', 'thirty', 'forty',
	'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/** Spell an integer in [0, 99]. */
function spellTwo(n: number): string {
	if (n < 10) return ONES[n];
	if (n < 20) return TEENS[n - 10];
	const tens = TENS[Math.floor(n / 10)];
	const ones = n % 10;
	return ones ? `${tens} ${ONES[ones]}` : tens;
}

/** Spell an integer in [0, 999]. */
function spellThree(n: number): string {
	const hundreds = Math.floor(n / 100);
	const rest = n % 100;
	if (hundreds === 0) return spellTwo(rest);
	const head = `${ONES[hundreds]} hundred`;
	return rest ? `${head} ${spellTwo(rest)}` : head;
}

/** Fully pronounced cardinal for a non-negative integer (handles thousands). */
function spellCardinal(n: number): string {
	if (n < 1000) return spellThree(n);
	const thousands = Math.floor(n / 1000);
	const rest = n % 1000;
	const head = `${spellThree(thousands)} thousand`;
	return rest ? `${head} ${spellThree(rest)}` : head;
}

/** Spell one digit alone, mapping 0 -> "zero". */
function digitWord(digit: string): string {
	return ONES[Number(digit)];
}

/**
 * Spell a two-character group the way radio dispatch reads it:
 * "00" -> "hundred", "0X" -> "oh X", "X0" -> a plain ten, "XY" -> "forty two".
 */
function pairGroup(pair: string): string {
	if (pair === '00') return 'hundred';
	if (pair[0] === '0') return `oh ${digitWord(pair[1])}`;
	return spellTwo(Number(pair));
}

/** Radio-style paired spelling of a digit string. */
function spellPaired(digits: string): string {
	switch (digits.length) {
		case 1:
			return digitWord(digits);
		case 2:
			return pairGroup(digits);
		case 3:
			return `${digitWord(digits[0])} ${pairGroup(digits.slice(1))}`;
		case 4:
			return `${pairGroup(digits.slice(0, 2))} ${pairGroup(digits.slice(2))}`;
		default:
			// 5+ digits have no natural pairing; fall back to a full reading.
			return spellCardinal(Number(digits));
	}
}

/**
 * Spell a cardinal number given as a digit string in the requested style.
 * The input is a string so leading zeros and length are preserved for the
 * paired reading (e.g. "2003" pairs differently than the integer 2003 would).
 */
export function spellNumber(digits: string, style: NumberStyle): string {
	switch (style) {
		case 'digits':
			return digits.split('').map(digitWord).join(' ');
		case 'spelled':
			return spellCardinal(Number(digits));
		case 'paired':
			return spellPaired(digits);
	}
}

const ORDINAL_IRREGULAR: Record<string, string> = {
	one: 'first',
	two: 'second',
	three: 'third',
	five: 'fifth',
	eight: 'eighth',
	nine: 'ninth',
	twelve: 'twelfth',
	twenty: 'twentieth',
	thirty: 'thirtieth',
	forty: 'fortieth',
	fifty: 'fiftieth',
	sixty: 'sixtieth',
	seventy: 'seventieth',
	eighty: 'eightieth',
	ninety: 'ninetieth',
	hundred: 'hundredth',
};

/** Turn the final word of a spelled cardinal into its ordinal form. */
function ordinalizeLastWord(text: string): string {
	const words = text.split(' ');
	const last = words[words.length - 1];
	words[words.length - 1] = ORDINAL_IRREGULAR[last] ?? `${last}th`;
	return words.join(' ');
}

/**
 * Spell an ordinal (a numbered street) in the requested style by ordinalizing
 * the last word of its cardinal reading: 6 -> "sixth", 16 -> "sixteenth",
 * 22 -> "twenty second", 230 paired -> "two thirtieth",
 * 230 spelled -> "two hundred thirtieth".
 */
export function spellOrdinal(value: number, style: NumberStyle): string {
	return ordinalizeLastWord(spellNumber(String(value), style));
}
