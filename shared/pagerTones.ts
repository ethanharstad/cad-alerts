/**
 * Pager tone sets: the two-tone sequential page (tone A, then tone B — Motorola
 * Quick Call II and the like) that a dispatch center sends to set off one
 * department's pagers. A dashboard listening to the pager audio uses them to
 * notice that the real dispatch has started and cut the pre-alert off rather
 * than talk over it.
 *
 * County-wide dispatch usually puts many agencies on one frequency, so only the
 * department's own tone sets count — another agency's page must not silence its
 * dashboards. A department may have several (its own page, an all-call, a
 * mutual-aid group), so it stores a list.
 *
 * The list is stored on the organization as text, one set per line —
 * `<tone A Hz> <tone B Hz> <optional label>`, e.g. `330.5 569.1 Station 1` — so
 * it is as easy to edit by hand in SQL as in the settings screen. Shared because
 * the settings screen checks it before sending, the API rejects a bad one that
 * arrives anyway, and the dashboard parses it to listen for.
 */

export interface PagerToneSet {
	/** First tone, in Hz. */
	a: number
	/** Second tone, in Hz. */
	b: number
	/** What the set pages (shown when it is heard); may be empty. */
	label: string
}

/** Upper bound on sets, so one org cannot store an unbounded blob. */
export const MAX_PAGER_TONE_SETS = 20

/** Paging tones sit in the voice band; anything outside is a typo. */
export const MIN_PAGER_TONE_HZ = 200
export const MAX_PAGER_TONE_HZ = 3500

/**
 * How far a received tone may be from its configured frequency and still match,
 * as a fraction. Encoders, radios and sound cards all drift a little, but the
 * standard tone tables space neighbouring tones only about 2.7% apart, so this
 * has to stay well inside that or one agency's tone would pass for another's.
 */
export const PAGER_TONE_TOLERANCE = 0.015

/**
 * Tones A and B must differ by at least this fraction: closer than that, the
 * detector could not tell the end of A from the start of B.
 */
export const MIN_PAGER_TONE_SEPARATION = 0.02

export const MAX_PAGER_TONE_LABEL_LENGTH = 60

const LINE_RE = /^(\d+(?:\.\d+)?)\s*(?:[,/]\s*|\s+)(\d+(?:\.\d+)?)(?:\s*[,:\-–]?\s*(.*))?$/

export interface ParsedPagerTones {
	sets: PagerToneSet[]
	/** Lines that could not be read, each with the reason, as typed. */
	errors: string[]
}

/**
 * Read stored or typed text into tone sets: one per line, blanks ignored, an
 * exact repeat of an earlier A/B pair dropped. Lines that are not a valid set
 * are reported in `errors` rather than silently dropped — a lost line would
 * quietly stop that page from cutting off pre-alerts.
 */
export function parsePagerToneSets(text: string | null | undefined): ParsedPagerTones {
	const sets: PagerToneSet[] = []
	const errors: string[] = []
	if (!text) return { sets, errors }
	for (const raw of text.split('\n')) {
		const line = raw.trim()
		if (line === '') continue
		const m = LINE_RE.exec(line)
		if (!m) {
			errors.push(`"${line}": expected tone A and tone B in Hz, e.g. 330.5 569.1`)
			continue
		}
		const a = Number(m[1])
		const b = Number(m[2])
		const label = (m[3] ?? '').trim()
		const outOfRange = [a, b].find((f) => f < MIN_PAGER_TONE_HZ || f > MAX_PAGER_TONE_HZ)
		if (outOfRange !== undefined) {
			errors.push(`"${line}": ${outOfRange} Hz is outside ${MIN_PAGER_TONE_HZ}–${MAX_PAGER_TONE_HZ} Hz`)
			continue
		}
		if (Math.abs(a - b) / Math.min(a, b) < MIN_PAGER_TONE_SEPARATION) {
			errors.push(`"${line}": tones A and B are too close together to tell apart`)
			continue
		}
		if (label.length > MAX_PAGER_TONE_LABEL_LENGTH) {
			errors.push(`"${line}": label is longer than ${MAX_PAGER_TONE_LABEL_LENGTH} characters`)
			continue
		}
		if (sets.some((s) => s.a === a && s.b === b)) continue
		sets.push({ a, b, label })
	}
	return { sets, errors }
}

/** Serialize sets for storage; an empty list is stored as null. */
export function formatPagerToneSets(sets: PagerToneSet[]): string | null {
	if (sets.length === 0) return null
	return sets.map((s) => (s.label ? `${s.a} ${s.b} ${s.label}` : `${s.a} ${s.b}`)).join('\n')
}

/** How a set is named to people: its label, or its tones when it has none. */
export function describePagerToneSet(set: PagerToneSet): string {
	const tones = `${set.a} / ${set.b} Hz`
	return set.label ? `${set.label} (${tones})` : tones
}
