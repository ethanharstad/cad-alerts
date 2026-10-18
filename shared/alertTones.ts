/**
 * Alert tones: a short sound a dashboard plays before reading an alert out, so
 * the room is listening by the time the first word lands. An organization picks
 * one tone for normal hours and, optionally, a different (or no) tone for its
 * quiet hours — overnight, say, when a gentler cue is wanted in the bunk room.
 *
 * The tones are built in: the audio files ship as static assets under
 * `public/tones/`, and an organization stores only a tone id. Shared because
 * both ends need the same rules — the settings screen to offer and check the
 * choices, the API to reject a bad value, and the dashboard to pick the tone.
 */

export interface AlertTone {
	/** Stable id stored on the organization. Never rename one in use. */
	id: string
	/** Human-readable name shown in the settings screen. */
	label: string
	/** Public URL of the audio file. */
	url: string
}

export const ALERT_TONES: readonly AlertTone[] = [
	{ id: 'burst-fade', label: 'Burst (fade in)', url: '/tones/burst-fade.wav' },
	{ id: 'purvis-soft', label: 'Purvis (soft)', url: '/tones/purvis-soft.wav' },
]

/** Whether a value is the id of a built-in tone. */
export function isValidToneId(id: unknown): id is string {
	return typeof id === 'string' && ALERT_TONES.some((t) => t.id === id)
}

/** The built-in tone with this id, or undefined (including for null). */
export function findTone(id: string | null | undefined): AlertTone | undefined {
	return ALERT_TONES.find((t) => t.id === id)
}

// ---- Quiet hours ----
// Stored as minutes after local midnight (0–1439). A window whose end is before
// its start wraps past midnight — 22:00–06:00 is the usual case. Both ends null
// means the organization has no quiet hours.

export const MINUTES_PER_DAY = 24 * 60

/** Whether a value is storable as a quiet-hours boundary. */
export function isValidMinuteOfDay(minutes: unknown): minutes is number {
	return (
		typeof minutes === 'number' &&
		Number.isInteger(minutes) &&
		minutes >= 0 &&
		minutes < MINUTES_PER_DAY
	)
}

/**
 * Whether `minuteOfDay` falls inside the window `[start, end)`. A null bound or
 * an empty window (start === end) means no quiet hours.
 */
export function isWithinQuietHours(
	start: number | null,
	end: number | null,
	minuteOfDay: number,
): boolean {
	if (start === null || end === null || start === end) return false
	if (start < end) return minuteOfDay >= start && minuteOfDay < end
	// Wraps past midnight.
	return minuteOfDay >= start || minuteOfDay < end
}

/** Parse an `HH:MM` string (as from `<input type="time">`) to minutes, or null. */
export function parseTimeOfDay(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
	if (!match) return null
	const hours = Number(match[1])
	const minutes = Number(match[2])
	if (hours > 23 || minutes > 59) return null
	return hours * 60 + minutes
}

/** Format minutes after midnight as `HH:MM`. */
export function formatTimeOfDay(minutes: number): string {
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export interface ToneSettings {
	alert_tone: string | null
	quiet_alert_tone: string | null
	quiet_hours_start: number | null
	quiet_hours_end: number | null
}

/**
 * The tone to play before an alert at `now`, or undefined for none. Quiet hours
 * are read against the dashboard's own clock: the kiosk sits in the station, so
 * its local time is the station's. During quiet hours the quiet tone is used —
 * including "none" — rather than falling back to the normal tone, so a
 * department can choose silence overnight.
 */
export function selectTone(settings: ToneSettings, now: Date): AlertTone | undefined {
	const minuteOfDay = now.getHours() * 60 + now.getMinutes()
	const quiet = isWithinQuietHours(settings.quiet_hours_start, settings.quiet_hours_end, minuteOfDay)
	return findTone(quiet ? settings.quiet_alert_tone : settings.alert_tone)
}
