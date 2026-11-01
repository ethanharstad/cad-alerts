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

/** The outcome of {@link limitSpokenText}. */
export interface LimitedText {
	text: string;
	/** True when the input was longer than the limit and was cut. */
	truncated: boolean;
}

/**
 * Collapse whitespace and cap `text` at `max` characters, cutting cleanly at the
 * last word boundary at or before the limit (a single unbroken word longer than
 * the limit is hard-cut). A truncated result ends with a period so TTS closes
 * the sentence instead of trailing off mid-phrase.
 */
export function limitSpokenText(text: string, max: number = MAX_SPOKEN_TEXT_LENGTH): LimitedText {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (normalized.length <= max) return { text: normalized, truncated: false };

	// Reserve one character for the closing period.
	const room = max - 1;
	let cut = normalized.slice(0, room + 1);
	const lastSpace = cut.lastIndexOf(' ');
	cut = lastSpace > 0 ? cut.slice(0, lastSpace) : normalized.slice(0, room);
	cut = cut.replace(/[\s.,;:!?-]+$/, '');
	return { text: `${cut}.`, truncated: true };
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
 * Whether an error from an upstream API call is permanent, i.e. a 4xx response
 * other than 408 (timeout) and 429 (rate limit): bad input, bad auth, a missing
 * model. Retrying those only repeats the failure (and, for a paid call, the
 * spend). 429, 5xx, and errors with no HTTP status (network failures, timeouts)
 * are transient and stay retryable. Duck-typed on `status` so the pipeline
 * never imports the OpenAI SDK; its `APIError` carries the response status there.
 */
export function isPermanentApiError(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const status = (err as { status?: unknown }).status;
	return (
		typeof status === 'number' &&
		status >= 400 &&
		status < 500 &&
		status !== 408 &&
		status !== 429
	);
}
