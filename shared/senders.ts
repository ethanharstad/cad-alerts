/**
 * Pre-alert sender allowlist. An organization lists who may send it pre-alerts:
 * exact addresses (`cad@county.gov`) and/or whole domains (`@county.gov`). The
 * list is stored on the organization as newline-separated text so it is just as
 * easy to edit by hand in SQL as in the settings screen.
 *
 * An empty list allows every sender, so organizations that predate the setting
 * keep working; the settings screen warns until one is configured.
 *
 * Shared because both ends need the same rules — the settings screen to reject a
 * bad entry before sending it, the API to reject one that arrives anyway, and
 * the intake pipeline to apply the list.
 */

/** Upper bound on entries, so one org cannot store an unbounded blob. */
export const MAX_ALLOWED_SENDERS = 50

// Deliberately loose: a local part and a dotted domain, no whitespace. Mail
// addresses are too varied for a strict check to be worth the false rejections.
const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN_RE = /^@[^\s@]+\.[^\s@]+$/

/**
 * Split stored or typed text into normalized entries: one per line (commas are
 * accepted too), trimmed, lower-cased, blanks and duplicates dropped.
 */
export function parseAllowedSenders(text: string | null | undefined): string[] {
	if (!text) return []
	const entries = text
		.split(/[\n,]/)
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0)
	return [...new Set(entries)]
}

/** Whether a single normalized entry is an address or an `@domain`. */
export function isValidSenderEntry(entry: string): boolean {
	return ADDRESS_RE.test(entry) || DOMAIN_RE.test(entry)
}

/** The entries of a list that are neither an address nor an `@domain`. */
export function invalidSenderEntries(entries: string[]): string[] {
	return entries.filter((entry) => !isValidSenderEntry(entry))
}

/** Serialize entries for storage; an empty list is stored as null. */
export function formatAllowedSenders(entries: string[]): string | null {
	return entries.length > 0 ? entries.join('\n') : null
}

/**
 * Whether `sender` may submit pre-alerts under `allowed` (normalized entries).
 * An empty list allows everyone. Matching is case-insensitive; an `@domain`
 * entry matches that exact domain only — `@county.gov` does not admit
 * `x@mail.county.gov`; list each subdomain that sends.
 */
export function isSenderAllowed(allowed: string[], sender: string): boolean {
	if (allowed.length === 0) return true
	const address = sender.trim().toLowerCase()
	const at = address.lastIndexOf('@')
	if (at <= 0) return false
	const domain = address.slice(at)
	return allowed.some((entry) => (entry.startsWith('@') ? entry === domain : entry === address))
}
