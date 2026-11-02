import type { Alert } from '../../shared/types'

import { DEFAULT_ACTIONABLE_WINDOW_MINUTES } from '../../shared/actionableWindow'

/**
 * How recent an alert must be to be worth announcing, when the organization has
 * not set a window of its own. Past this the call is no longer actionable — the
 * crew has either responded or the moment has passed — and reading it out only
 * talks over whatever is happening now.
 */
export const DEFAULT_ACTIONABLE_WINDOW_MS = DEFAULT_ACTIONABLE_WINDOW_MINUTES * 60_000

/**
 * How long, after the department's pager tones are heard, no pre-alert is read
 * out. The dispatcher's voice follows the tones, and a pre-alert landing then —
 * usually the same call, a few seconds behind — would talk straight over it.
 */
export const DEFAULT_PREEMPT_HOLD_MS = 60_000

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
 * A newer alert never cuts off one already being spoken — cutting it off
 * mid-word is worse than letting it end. The one thing that does is the real
 * dispatch: {@link preempt} stops playback when the department's pager tones are
 * heard, and holds off further announcements while the dispatcher talks. A
 * pre-alert cut off that way is not replayed; the dispatch has replaced it.
 *
 * `speak` is expected to resolve when playback *ends*, not when it begins, and
 * to stop promptly when its signal aborts. A rejection is swallowed: one alert
 * that fails to play must not wedge the next.
 */
export function createAlertAnnouncer(
	speak: (alert: Alert, signal: AbortSignal) => Promise<void>,
	options: AnnouncerOptions = {},
) {
	const now = options.now ?? (() => Date.now())
	const windowMs = options.windowMs ?? (() => DEFAULT_ACTIONABLE_WINDOW_MS)
	let pending: Alert | null = null
	let speaking = false
	let current: AbortController | null = null
	// Epoch ms until which nothing is announced (see preempt).
	let holdUntil = 0

	const drain = async () => {
		if (speaking) return
		speaking = true
		try {
			// Re-read each pass: an alert offered while one is playing is picked up
			// by the run already in progress rather than starting a second one.
			while (pending) {
				const next = pending
				pending = null
				current = new AbortController()
				try {
					await speak(next, current.signal)
				} catch {
					// Already logged by the caller; carry on.
				} finally {
					current = null
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
			if (now() < holdUntil) return
			if (now() - alert.timestamp > windowMs()) return
			if (pending && pending.timestamp > alert.timestamp) return
			pending = alert
			void drain()
		},
		/** Drop what is waiting. Anything already playing still finishes. */
		clear() {
			pending = null
		},
		/**
		 * The real dispatch has started: stop whatever is playing, drop what is
		 * waiting, and announce nothing more for `holdMs`. Alerts offered during
		 * the hold are dropped, not deferred — they are almost always the call
		 * being dispatched, and reading one out afterwards would only repeat it.
		 * A second preempt during a hold extends it.
		 */
		preempt(holdMs: number = DEFAULT_PREEMPT_HOLD_MS) {
			pending = null
			holdUntil = Math.max(holdUntil, now() + holdMs)
			current?.abort()
		},
		/** Whether announcements are held off after a preempt. */
		get isHolding() {
			return now() < holdUntil
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
