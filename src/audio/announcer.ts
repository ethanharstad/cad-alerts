import type { Alert } from '../../shared/types'

import { DEFAULT_ACTIONABLE_WINDOW_MINUTES } from '../../shared/actionableWindow'

/**
 * How recent an alert must be to be worth announcing, when the organization has
 * not set a window of its own. Past this the call is no longer actionable — the
 * crew has either responded or the moment has passed — and reading it out only
 * talks over whatever is happening now.
 */
export const DEFAULT_ACTIONABLE_WINDOW_MS = DEFAULT_ACTIONABLE_WINDOW_MINUTES * 60_000

export interface AnnouncerOptions {
	/** The actionable window in ms, read afresh each time an alert is offered. */
	windowMs?: () => number
	/** Injectable clock, so tests need not wait. */
	now?: () => number
}

/**
 * Announces the latest actionable alert, and only that one.
 *
 * The dashboard can learn about several alerts at once — a backlog missed during
 * a pause, or a fallback poll returning the whole recent list — and reading them
 * all out is wrong twice over: they would overlap, and most of them describe
 * calls that have already been handled. So at most one alert is ever waiting to
 * be spoken, always the newest offered, and it is dropped if it is older than
 * the actionable window (see {@link DEFAULT_ACTIONABLE_WINDOW_MS}).
 *
 * An alert already being spoken is left to finish — there is no way to un-hear
 * it, and cutting it off mid-word is worse than letting it end.
 *
 * `speak` is expected to resolve when playback *ends*, not when it begins. A
 * rejection is swallowed: one alert that fails to play must not wedge the next.
 */
export function createAlertAnnouncer(
	speak: (alert: Alert) => Promise<void>,
	options: AnnouncerOptions = {},
) {
	const now = options.now ?? (() => Date.now())
	const windowMs = options.windowMs ?? (() => DEFAULT_ACTIONABLE_WINDOW_MS)
	let pending: Alert | null = null
	let speaking = false

	const drain = async () => {
		if (speaking) return
		speaking = true
		try {
			// Re-read each pass: an alert offered while one is playing is picked up
			// by the run already in progress rather than starting a second one.
			while (pending) {
				const next = pending
				pending = null
				try {
					await speak(next)
				} catch {
					// Already logged by the caller; carry on.
				}
			}
		} finally {
			speaking = false
		}
	}

	return {
		/**
		 * Offer an alert. It is spoken unless it is stale, or unless something
		 * newer is already waiting — offering an older alert never displaces a
		 * newer one, whatever order they arrive in.
		 */
		announce(alert: Alert) {
			if (now() - alert.timestamp > windowMs()) return
			if (pending && pending.timestamp > alert.timestamp) return
			pending = alert
			void drain()
		},
		/** Drop what is waiting. Anything already playing still finishes. */
		clear() {
			pending = null
		},
		/** Whether an alert is waiting to be spoken (at most one, ever). */
		get hasPending() {
			return pending !== null
		},
		/** Whether an alert is playing or waiting to — i.e. not safe to interrupt. */
		get isBusy() {
			return speaking || pending !== null
		},
	}
}
