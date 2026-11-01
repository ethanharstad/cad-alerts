import { PAGER_TONE_TOLERANCE, type PagerToneSet } from '../../shared/pagerTones'

/**
 * Two-tone sequential pager decoder. Fed raw samples from the pager audio, it
 * reports when one of the department's tone sets has been sent: tone A held,
 * then tone B straight after it, held long enough to be sure.
 *
 * Each configured frequency gets its own Goertzel filter, run over back-to-back
 * blocks. A block counts as "tone present" when enough of its energy sits at
 * that one frequency (its *purity*) and it is loud enough to be more than hiss.
 * Speech spreads its energy across many harmonics and never holds one pitch for
 * long, so a run of pure blocks lasting most of a second is a tone.
 *
 * The block length sets how selective the filter is: a tone off by exactly the
 * tolerance keeps half its power, and one off by the 2.7% spacing of the
 * standard tone tables keeps about 5%. So the length is chosen per frequency —
 * long for low tones, short for high ones — to make the tolerance a fixed
 * fraction rather than a fixed number of Hz.
 *
 * Pure and synchronous: it never touches the Web Audio API, so the tests can
 * feed it synthesized audio.
 */

export interface PagerToneDetectorOptions {
	sampleRate: number
	sets: readonly PagerToneSet[]
	/** Called once per page heard, as soon as tone B has been held `minToneBMs`. */
	onMatch: (set: PagerToneSet) => void
	/**
	 * Called once per run of any configured tone that has lasted `minToneAMs` —
	 * for setup screens, to show which tones are getting through.
	 */
	onTone?: (hz: number) => void
	/** Allowed frequency error, as a fraction. */
	tolerance?: number
	/** Fraction of a block's energy that must be at the tone. */
	minPurity?: number
	/** RMS (full scale = 1) below which a block is treated as silence. */
	minLevel?: number
	/** How long tone A must last. Quick Call II sends it for about 1 s. */
	minToneAMs?: number
	/** How long tone B must be held before cutting in. */
	minToneBMs?: number
	/** Longest silence allowed between the end of A and the start of B. */
	maxGapMs?: number
	/** Longest dropout (fading, a squelch burst) that does not break a tone. */
	dropoutMs?: number
}

export const DEFAULT_MIN_PURITY = 0.4
export const DEFAULT_MIN_LEVEL = 0.003 // about −50 dBFS
export const DEFAULT_MIN_TONE_A_MS = 500
export const DEFAULT_MIN_TONE_B_MS = 600
export const DEFAULT_MAX_GAP_MS = 400
export const DEFAULT_DROPOUT_MS = 150

/** Corner of the high-pass applied first, so mains hum does not mask a tone. */
const HIGH_PASS_HZ = 150

/**
 * sinc²(x) = ½ at x ≈ 0.443: a block of `0.443 / Δf` seconds passes a tone
 * that far off frequency at half power.
 */
const HALF_POWER_BINS = 0.443

interface Run {
	/** ms since the detector started. */
	start: number
	end: number
	/** Whether `onTone` has fired for this run. */
	announced: boolean
}

interface Tracker {
	hz: number
	coeff: number
	blockLength: number
	blockMs: number
	count: number
	s1: number
	s2: number
	energy: number
	run: Run | null
}

export interface PagerToneDetector {
	/** Feed the next samples (mono, −1…1). */
	process(samples: Float32Array): void
}

export function createPagerToneDetector(options: PagerToneDetectorOptions): PagerToneDetector {
	const fs = options.sampleRate
	const tolerance = options.tolerance ?? PAGER_TONE_TOLERANCE
	const minPurity = options.minPurity ?? DEFAULT_MIN_PURITY
	const minLevel = options.minLevel ?? DEFAULT_MIN_LEVEL
	const minToneAMs = options.minToneAMs ?? DEFAULT_MIN_TONE_A_MS
	const minToneBMs = options.minToneBMs ?? DEFAULT_MIN_TONE_B_MS
	const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS
	const dropoutMs = options.dropoutMs ?? DEFAULT_DROPOUT_MS
	const sets = [...options.sets]

	// One tracker per distinct frequency; sets that share a tone share a tracker.
	const trackers = new Map<number, Tracker>()
	for (const set of sets) {
		for (const hz of [set.a, set.b]) {
			if (trackers.has(hz)) continue
			const blockLength = Math.max(32, Math.round((HALF_POWER_BINS * fs) / (tolerance * hz)))
			trackers.set(hz, {
				hz,
				coeff: 2 * Math.cos((2 * Math.PI * hz) / fs),
				blockLength,
				blockMs: (blockLength / fs) * 1000,
				count: 0,
				s1: 0,
				s2: 0,
				energy: 0,
				run: null,
			})
		}
	}
	const trackerList = [...trackers.values()]

	// The tone B run each set last fired on, so one page fires once.
	const firedOn = new Map<PagerToneSet, number>()

	// One-pole high-pass state.
	const rc = 1 / (2 * Math.PI * HIGH_PASS_HZ)
	const alpha = rc / (rc + 1 / fs)
	let prevIn = 0
	let prevOut = 0

	let sampleIndex = 0

	const checkSets = (b: Tracker) => {
		const bRun = b.run!
		if (bRun.end - bRun.start < minToneBMs) return
		for (const set of sets) {
			if (set.b !== b.hz || firedOn.get(set) === bRun.start) continue
			const a = trackers.get(set.a)!
			const aRun = a.run
			if (!aRun || aRun.end - aRun.start < minToneAMs) continue
			// Blocks straddle the changeover, so each run can overhang the real tone
			// edge by up to a block; allow that much overlap, and a short gap.
			const gap = bRun.start - aRun.end
			if (gap > maxGapMs || gap < -(a.blockMs + b.blockMs)) continue
			if (aRun.start >= bRun.start) continue
			firedOn.set(set, bRun.start)
			options.onMatch(set)
		}
	}

	const endBlock = (t: Tracker) => {
		const n = t.blockLength
		const power = t.s1 * t.s1 + t.s2 * t.s2 - t.coeff * t.s1 * t.s2
		// A pure sine on frequency gives power = (n/2)·energy, so purity ≈ 1.
		const purity = t.energy > 0 ? power / ((n / 2) * t.energy) : 0
		const rms = Math.sqrt(t.energy / n)
		const end = (sampleIndex / fs) * 1000
		const start = end - t.blockMs
		t.count = 0
		t.s1 = 0
		t.s2 = 0
		t.energy = 0

		if (rms < minLevel || purity < minPurity) return
		if (t.run && start - t.run.end <= dropoutMs) {
			t.run.end = end
		} else {
			t.run = { start, end, announced: false }
		}
		if (!t.run.announced && t.run.end - t.run.start >= minToneAMs) {
			t.run.announced = true
			options.onTone?.(t.hz)
		}
		checkSets(t)
	}

	return {
		process(samples) {
			for (let i = 0; i < samples.length; i++) {
				const x = samples[i]!
				const y = alpha * (prevOut + x - prevIn)
				prevIn = x
				prevOut = y
				sampleIndex++
				for (const t of trackerList) {
					const s0 = y + t.coeff * t.s1 - t.s2
					t.s2 = t.s1
					t.s1 = s0
					t.energy += y * y
					if (++t.count === t.blockLength) endBlock(t)
				}
			}
		},
	}
}
