/**
 * Guards around the paid speech-synthesis call: a cap on how much text reaches
 * TTS, and the classification of which upstream failures are worth retrying.
 */

/**
 * Longest spoken alert we synthesize, in characters. A normal pre-alert renders
 * to well under 200; this leaves room for long business names and apartment
 * details while keeping a malformed or malicious email from producing a long,
 * expensive (and, on a station dashboard, useless) announcement.
 */
export const MAX_SPOKEN_TEXT_LENGTH = 400;

/**
 * Per-field caps on what a parsed pre-alert may contribute to the spoken text,
 * in characters of the raw CAD field. Applied before rendering so one oversized
 * field (a runaway nature, a pasted paragraph in the address) is shortened on
 * its own instead of pushing the rest of the alert — above all the location —
 * past {@link MAX_SPOKEN_TEXT_LENGTH}. Generous next to real fields (a nature is
 * a few words, an address with business ~40 chars). The address is spoken
 * twice by the default template and numbers expand when spelled out, so its
 * cap is the tightest relative to its rendered size. A business name rides at
 * the end of the address (after ";"), so it is the first thing an address cut
 * drops.
 */
export const MAX_SPEECH_FIELD_LENGTH = {
	nature: 80,
	address: 100,
	city: 40,
} as const;

export type SpeechField = keyof typeof MAX_SPEECH_FIELD_LENGTH;

/**
 * Cut `text` to at most `max` characters at the last word boundary (a single
 * word longer than `max` is hard-cut), dropping trailing punctuation left
 * dangling by the cut. Returns `text` unchanged when it already fits.
 */
export function truncateAtWord(text: string, max: number): string {
	if (text.length <= max) return text;
	const head = text.slice(0, max + 1);
	const lastSpace = head.lastIndexOf(' ');
	const cut = lastSpace > 0 ? head.slice(0, lastSpace) : text.slice(0, max);
	return cut.replace(/[\s.,;:!?-]+$/, '');
}

/**
 * Cap each speech-relevant field of `fields` at its {@link MAX_SPEECH_FIELD_LENGTH}.
 * Returns the capped copy and the names of the fields that were cut, so the
 * caller can log. Only the copy used for speech is capped; the stored alert
 * keeps the full parsed fields.
 */
export function limitSpeechFields<T extends Record<SpeechField, string>>(
	fields: T,
): { fields: T; truncated: SpeechField[] } {
	const out = { ...fields };
	const truncated: SpeechField[] = [];
	for (const key of Object.keys(MAX_SPEECH_FIELD_LENGTH) as SpeechField[]) {
		const value = fields[key].replace(/\s+/g, ' ').trim();
		const limited = truncateAtWord(value, MAX_SPEECH_FIELD_LENGTH[key]);
		if (limited !== value) {
			truncated.push(key);
			out[key] = limited as T[SpeechField];
		}
	}
	return { fields: out, truncated };
}

/** The outcome of {@link limitSpokenText}. */
export interface LimitedText {
	text: string;
	/** True when the input was longer than the limit and was cut. */
	truncated: boolean;
}

/**
 * Backstop cap on the final rendered text, after the per-field caps. Text that
 * fits is returned exactly as given. Text over `max` has its whitespace
 * collapsed (which may be enough on its own); if still too long it is cut at
 * the last word boundary and closed with a period so TTS ends the sentence
 * instead of trailing off.
 */
export function limitSpokenText(text: string, max: number = MAX_SPOKEN_TEXT_LENGTH): LimitedText {
	if (text.length <= max) return { text, truncated: false };
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (normalized.length <= max) return { text: normalized, truncated: false };
	// Reserve one character for the closing period.
	return { text: `${truncateAtWord(normalized, max - 1)}.`, truncated: true };
}

/**
 * Whether text is worth synthesizing at all: it must contain at least one
 * letter or digit. Blank text (or nothing but punctuation) means the template
 * or parse went wrong, and retrying would only produce the same result.
 */
export function isSpeakable(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

/**
 * 4xx statuses that can clear up on their own and so stay retryable: 408
 * (timeout), 429 (rate limit), and 401/403 (auth), which a key or gateway-token
 * rotation still propagating can cause briefly. Retries are bounded by the step
 * config, so a truly bad key costs only failed (unbilled) requests.
 */
const TRANSIENT_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

/**
 * Whether an error from an upstream API call is permanent, i.e. a 4xx response
 * not in {@link TRANSIENT_CLIENT_STATUSES}: bad input, a missing model, an
 * oversized request. Retrying those only repeats the failure (and, for a paid
 * call, the spend). 5xx and errors with no HTTP status (network failures,
 * timeouts) are transient and stay retryable. Duck-typed on `status` so the pipeline
 * never imports the OpenAI SDK; its `APIError` carries the response status there.
 */
export function isPermanentApiError(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const status = (err as { status?: unknown }).status;
	return (
		typeof status === 'number' &&
		status >= 400 &&
		status < 500 &&
		!TRANSIENT_CLIENT_STATUSES.has(status)
	);
}
