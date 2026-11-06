/**
 * When to play the pager audio out loud. A dashboard can broadcast the pager
 * audio on its alert output once the department's tones are heard, so the bay
 * hears the dispatch even when the receiver itself is only wired into this
 * computer.
 *
 * The broadcast opens on a match and stays open while the channel is busy. It
 * closes once the input has been quiet for `silenceMs` (the receiver's squelch
 * has closed: dispatch is over), or after `maxMs` in any case, so a receiver
 * with open squelch — steady hiss — cannot hold the PA open for good. Another
 * match while open starts the count afresh.
 *
 * Playback is live, so it starts part-way through tone B, when the decoder
 * recognises the page; the tones themselves are not repeated.
 *
 * Pure: it is driven with timestamps and input levels and never touches the Web
 * Audio API, so the tests can step it through a page.
 */

/** Quiet this long after the last sound and the broadcast ends. */
export const DEFAULT_BROADCAST_SILENCE_MS = 5000
/** The longest one broadcast may last. */
export const DEFAULT_BROADCAST_MAX_MS = 3 * 60_000
/** Input level, in dBFS, below which the channel counts as quiet. */
export const DEFAULT_BROADCAST_SILENCE_DBFS = -50

export interface PagerBroadcastGateOptions {
	silenceMs?: number
	maxMs?: number
	silenceDbfs?: number
}

export interface PagerBroadcastGate {
	readonly isOpen: boolean
	/** A page was heard at `now`: open, or keep open with the counts restarted. */
	open(now: number): void
	/**
	 * The input level at `now`. Returns `true` when this reading closed the
	 * broadcast, so the caller can fade it out.
	 */
	level(dbfs: number, now: number): boolean
	/** Close at once, e.g. when the monitor stops. */
	close(): void
}

export function createPagerBroadcastGate(options: PagerBroadcastGateOptions = {}): PagerBroadcastGate {
	const silenceMs = options.silenceMs ?? DEFAULT_BROADCAST_SILENCE_MS
	const maxMs = options.maxMs ?? DEFAULT_BROADCAST_MAX_MS
	const silenceDbfs = options.silenceDbfs ?? DEFAULT_BROADCAST_SILENCE_DBFS

	let isOpen = false
	let openedAt = 0
	let lastSound = 0

	return {
		get isOpen() {
			return isOpen
		},
		open(now) {
			isOpen = true
			openedAt = now
			lastSound = now
		},
		level(dbfs, now) {
			if (!isOpen) return false
			if (dbfs >= silenceDbfs) lastSound = now
			if (now - lastSound >= silenceMs || now - openedAt >= maxMs) {
				isOpen = false
				return true
			}
			return false
		},
		close() {
			isOpen = false
		},
	}
}
