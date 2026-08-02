/**
 * The actionable window: how recent a call must be for a dashboard to read it
 * out loud. Past it the crew has responded or the moment has passed, and
 * announcing it only talks over whatever is happening now.
 *
 * Shared because both ends need the same rule — the settings screen to reject a
 * bad value before sending it, and the API to reject one that arrives anyway.
 */

export const MIN_ACTIONABLE_WINDOW_MINUTES = 1
export const MAX_ACTIONABLE_WINDOW_MINUTES = 60

/** Used when an organization has not set one (a null column). */
export const DEFAULT_ACTIONABLE_WINDOW_MINUTES = 5

/**
 * Whether a value is storable as an organization's window: a whole number of
 * minutes within bounds. Fractions are rejected — a window of 2.5 minutes is
 * more likely a typo than an intent.
 */
export function isValidActionableWindow(minutes: unknown): minutes is number {
	return (
		typeof minutes === 'number' &&
		Number.isInteger(minutes) &&
		minutes >= MIN_ACTIONABLE_WINDOW_MINUTES &&
		minutes <= MAX_ACTIONABLE_WINDOW_MINUTES
	)
}
