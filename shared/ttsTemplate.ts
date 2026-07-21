/**
 * The token-based text-to-speech template — the single source of truth for the
 * template's token vocabulary and parsing, shared by both the Worker (which
 * renders a spoken alert from a template string) and the SPA (whose settings
 * editor lists the tokens and highlights which ones parse).
 *
 * This module is deliberately pure: no Drizzle, no server modules, no address
 * tokenizer. It only knows token *names* and how to split a template into
 * segments. The actual spoken *values* for each token live server-side in
 * `server/template.ts` (they need the address tokenizer and number speller),
 * which imports the names and parser from here so the two never drift.
 */

/** A recognized template token and the human description shown in the editor. */
export interface TtsToken {
	/** The token name as written between braces, e.g. `nature` for `{nature}`. */
	name: string
	/** Short description of what the token speaks, for the editor's palette. */
	description: string
}

/**
 * The tokens a template may contain. Writing a token twice speaks its value
 * twice (this is how the address is repeated); everything between tokens is
 * literal free text.
 */
export const TTS_TOKENS: readonly TtsToken[] = [
	{ name: 'nature', description: 'The nature of the call, expanded for speech (e.g. "Back Pain").' },
	{ name: 'address', description: 'The spoken address. Write it twice to have it read twice.' },
	{ name: 'city', description: 'The city name.' },
	{ name: 'business', description: 'A business name at the address, if any. Empty otherwise.' },
	{ name: 'apartment', description: 'An apartment/unit at the address, if any. Empty otherwise.' },
] as const

/** Fast membership set of the known token names. */
export const TOKEN_NAMES: ReadonlySet<string> = new Set(TTS_TOKENS.map((t) => t.name))

/**
 * The default template, applied to any organization that has not set its own. It
 * reproduces the historical spoken output: the nature, the address twice, an
 * optional business, then the city preceded by "in". The `{business}` sentence
 * collapses when there is no business (see `renderAlertTextFromString`).
 */
export const DEFAULT_TTS_TEMPLATE = '{nature}. {address}. {address}. {business}. in {city}.'

/** One piece of a parsed template: literal text or a (possibly unknown) token. */
export type TemplateSegment =
	| { type: 'text'; value: string }
	| { type: 'token'; name: string; known: boolean }

const TOKEN_PATTERN = /\{(\w+)\}/g

/**
 * Split a template into its literal-text and token segments, marking each token
 * as `known` when its name is in {@link TOKEN_NAMES}. Both the server renderer
 * and the SPA editor build on this, so they agree on exactly which `{...}`
 * placeholders are tokens.
 */
export function parseTemplate(template: string): TemplateSegment[] {
	const segments: TemplateSegment[] = []
	let lastIndex = 0
	for (const match of template.matchAll(TOKEN_PATTERN)) {
		const index = match.index ?? 0
		if (index > lastIndex) {
			segments.push({ type: 'text', value: template.slice(lastIndex, index) })
		}
		const name = match[1] ?? ''
		segments.push({ type: 'token', name, known: TOKEN_NAMES.has(name) })
		lastIndex = index + match[0].length
	}
	if (lastIndex < template.length) {
		segments.push({ type: 'text', value: template.slice(lastIndex) })
	}
	return segments
}

/**
 * Validate a template: it is valid when every `{...}` placeholder names a known
 * token. Returns the list of unknown token names (de-duplicated, in order of
 * first appearance) so callers can report exactly what is wrong.
 */
export function validateTemplate(template: string): { valid: boolean; unknownTokens: string[] } {
	const unknown: string[] = []
	for (const segment of parseTemplate(template)) {
		if (segment.type === 'token' && !segment.known && !unknown.includes(segment.name)) {
			unknown.push(segment.name)
		}
	}
	return { valid: unknown.length === 0, unknownTokens: unknown }
}
