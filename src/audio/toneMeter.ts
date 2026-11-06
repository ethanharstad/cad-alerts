/**
 * Measures any steady tone on the pager input, configured or not, for setup
 * screens. The decoder only listens at the configured frequencies, so when a
 * page is not recognised it cannot say why; this says what actually arrived —
 * a tone a little off frequency, or one cut short or lost on the way in (an
 * audio enhancement on the input treating it as noise, say).
 *
 * Each block's frequency comes from its zero crossings (interpolated, with
 * hysteresis so hiss near zero does not add crossings), and the block only
 * counts when most of its energy sits at that frequency, so speech and noise
 * are ignored. A run of blocks that agree is reported when it ends.
 *
 * Pure and synchronous, like the decoder, so the tests feed it synthesized
 * audio.
 */

import { MAX_PAGER_TONE_HZ, MIN_PAGER_TONE_HZ } from '../../shared/pagerTones'

export interface MeasuredTone {
	/** Mean frequency over the run, in Hz. */
	hz: number
	/** How long it lasted, in ms. */
	ms: number
	/** Mean level, in dBFS. */
	dbfs: number
}

export interface ToneMeterOptions {
	sampleRate: number
	/** Called when a steady tone ends (or is still going after `flush`). */
	onTone: (tone: MeasuredTone) => void
	/** Shortest run reported. */
	minMs?: number
}

export interface ToneMeter {
	process(samples: Float32Array): void
	/** Report a run still in progress. */
	flush(): void
}

const BLOCK_MS = 50
const MIN_PURITY = 0.6
const MIN_RMS = 0.003 // about −50 dBFS, as the decoder
/** Blocks in one run must agree this closely. */
const RUN_TOLERANCE = 0.01
const HIGH_PASS_HZ = 150

export function createToneMeter(options: ToneMeterOptions): ToneMeter {
	const fs = options.sampleRate
	const minMs = options.minMs ?? 300
	const n = Math.round((BLOCK_MS / 1000) * fs)
	const block = new Float32Array(n)
	let filled = 0

	const rc = 1 / (2 * Math.PI * HIGH_PASS_HZ)
	const alpha = rc / (rc + 1 / fs)
	let prevIn = 0
	let prevOut = 0

	let run: { hzSum: number; rmsSum: number; blocks: number } | null = null

	const endRun = () => {
		if (run && run.blocks * BLOCK_MS >= minMs) {
			const rms = run.rmsSum / run.blocks
			options.onTone({
				hz: Math.round((run.hzSum / run.blocks) * 10) / 10,
				ms: run.blocks * BLOCK_MS,
				dbfs: Math.round(20 * Math.log10(rms)),
			})
		}
		run = null
	}

	const measure = (): { hz: number; rms: number } | null => {
		let energy = 0
		for (let i = 0; i < n; i++) energy += block[i]! * block[i]!
		const rms = Math.sqrt(energy / n)
		if (rms < MIN_RMS) return null

		// Positive-going crossings, armed only once the signal has gone well
		// below zero.
		const h = 0.3 * rms
		let armed = false
		let first = -1
		let last = -1
		let crossings = 0
		for (let i = 1; i < n; i++) {
			const x = block[i]!
			if (x < -h) armed = true
			const prev = block[i - 1]!
			if (armed && prev < 0 && x >= 0) {
				const t = i - 1 + prev / (prev - x)
				if (first < 0) first = t
				last = t
				crossings++
				armed = false
			}
		}
		if (crossings < 3) return null
		const hz = ((crossings - 1) * fs) / (last - first)
		if (hz < MIN_PAGER_TONE_HZ || hz > MAX_PAGER_TONE_HZ) return null

		// Most of the energy must be at that one frequency.
		const coeff = 2 * Math.cos((2 * Math.PI * hz) / fs)
		let s1 = 0
		let s2 = 0
		for (let i = 0; i < n; i++) {
			const s0 = block[i]! + coeff * s1 - s2
			s2 = s1
			s1 = s0
		}
		const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
		const purity = power / ((n / 2) * energy)
		return purity >= MIN_PURITY ? { hz, rms } : null
	}

	const endBlock = () => {
		filled = 0
		const m = measure()
		if (!m) return endRun()
		if (run && Math.abs(m.hz - run.hzSum / run.blocks) > RUN_TOLERANCE * m.hz) endRun()
		if (!run) run = { hzSum: 0, rmsSum: 0, blocks: 0 }
		run.hzSum += m.hz
		run.rmsSum += m.rms
		run.blocks++
	}

	return {
		process(samples) {
			for (let i = 0; i < samples.length; i++) {
				const x = samples[i]!
				const y = alpha * (prevOut + x - prevIn)
				prevIn = x
				prevOut = y
				block[filled++] = y
				if (filled === n) endBlock()
			}
		},
		flush: endRun,
	}
}
