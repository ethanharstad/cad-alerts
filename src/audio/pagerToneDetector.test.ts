import { describe, it, expect } from 'vitest'

import { createPagerToneDetector } from './pagerToneDetector'
import type { PagerToneSet } from '../../shared/pagerTones'

const FS = 48_000

// Deterministic noise, so a failure reproduces.
function rng(seed = 1) {
	let s = seed
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0
		return s / 2 ** 32 - 0.5
	}
}

type Segment =
	| { tone: number; ms: number; amp?: number }
	| { silence: number }
	| { noise: number; amp?: number }
	| { speech: number }

/** Render segments to one buffer, with optional background noise throughout. */
function render(segments: Segment[], backgroundNoise = 0, fs = FS): Float32Array {
	const rand = rng(7)
	const chunks: number[] = []
	let phase = 0
	for (const seg of segments) {
		if ('tone' in seg) {
			const n = Math.round((seg.ms / 1000) * fs)
			const amp = seg.amp ?? 0.5
			for (let i = 0; i < n; i++) {
				chunks.push(amp * Math.sin(phase))
				phase += (2 * Math.PI * seg.tone) / fs
			}
		} else if ('silence' in seg) {
			const n = Math.round((seg.silence / 1000) * fs)
			for (let i = 0; i < n; i++) chunks.push(0)
		} else if ('noise' in seg) {
			const n = Math.round((seg.noise / 1000) * fs)
			for (let i = 0; i < n; i++) chunks.push((seg.amp ?? 0.5) * rand())
		} else {
			// Crude voiced speech: a gliding 120–220 Hz fundamental with harmonics,
			// so some harmonic sweeps across every tone in the band.
			const n = Math.round((seg.speech / 1000) * fs)
			let p = 0
			for (let i = 0; i < n; i++) {
				const t = i / fs
				const f0 = 170 + 50 * Math.sin(2 * Math.PI * 1.3 * t)
				p += (2 * Math.PI * f0) / fs
				let v = 0
				for (let h = 1; h <= 15; h++) v += Math.sin(h * p) / h
				chunks.push(0.2 * v)
			}
		}
	}
	const out = Float32Array.from(chunks)
	if (backgroundNoise > 0) for (let i = 0; i < out.length; i++) out[i]! += backgroundNoise * rand()
	return out
}

const STATION_1: PagerToneSet = { a: 330.5, b: 569.1, label: 'Station 1' }
const ALL_CALL: PagerToneSet = { a: 1092.4, b: 832.5, label: 'All call' }
// A neighbouring agency on the same channel, one tone-table step from ours.
const NEIGHBOR: PagerToneSet = { a: 339.6, b: 569.1, label: 'Neighbor' }

function detect(audio: Float32Array, sets: PagerToneSet[] = [STATION_1, ALL_CALL], chunk = 128) {
	const matches: string[] = []
	const matchTimesMs: number[] = []
	const tones: number[] = []
	let fed = 0
	const detector = createPagerToneDetector({
		sampleRate: FS,
		sets,
		onMatch: (s) => {
			matches.push(s.label)
			matchTimesMs.push((fed / FS) * 1000)
		},
		onTone: (hz) => tones.push(hz),
	})
	for (let i = 0; i < audio.length; i += chunk) {
		const part = audio.subarray(i, i + chunk)
		detector.process(part)
		fed += part.length
	}
	return { matches, matchTimesMs, tones }
}

const page = (set: PagerToneSet, opts: { aMs?: number; bMs?: number; detune?: number } = {}): Segment[] => [
	{ tone: set.a * (1 + (opts.detune ?? 0)), ms: opts.aMs ?? 1000 },
	{ tone: set.b * (1 + (opts.detune ?? 0)), ms: opts.bMs ?? 3000 },
]

describe('createPagerToneDetector', () => {
	it('recognizes a Quick Call II page and cuts in well before tone B ends', () => {
		const { matches, matchTimesMs } = detect(render([{ silence: 500 }, ...page(STATION_1), { silence: 500 }]))
		expect(matches).toEqual(['Station 1'])
		// A ends at 1.5 s; the match should land within about a second of B starting.
		expect(matchTimesMs[0]).toBeGreaterThan(1500)
		expect(matchTimesMs[0]).toBeLessThan(2500)
	})

	it('fires once per page, and again for the next page', () => {
		const { matches } = detect(
			render([...page(STATION_1), { silence: 5000 }, ...page(STATION_1)]),
		)
		expect(matches).toEqual(['Station 1', 'Station 1'])
	})

	it('recognizes each of several configured sets', () => {
		const { matches } = detect(render([...page(ALL_CALL), { silence: 2000 }, ...page(STATION_1)]))
		expect(matches).toEqual(['All call', 'Station 1'])
	})

	it('picks out our page among other agencies stacked on the same channel', () => {
		const other: PagerToneSet = { a: 433.7, b: 746.8, label: 'Other' }
		const { matches } = detect(render([...page(other), ...page(NEIGHBOR), ...page(STATION_1)]))
		expect(matches).toEqual(['Station 1'])
	})

	it('ignores a neighbouring agency one tone-table step away', () => {
		expect(detect(render(page(NEIGHBOR))).matches).toEqual([])
	})

	it('ignores our tones in the wrong order', () => {
		expect(
			detect(render([{ tone: STATION_1.b, ms: 1000 }, { tone: STATION_1.a, ms: 3000 }])).matches,
		).toEqual([])
	})

	it('ignores tone B alone, and tone A alone', () => {
		expect(detect(render([{ tone: STATION_1.b, ms: 4000 }])).matches).toEqual([])
		expect(detect(render([{ tone: STATION_1.a, ms: 4000 }])).matches).toEqual([])
	})

	it('ignores a tone A too short to be a page', () => {
		expect(detect(render(page(STATION_1, { aMs: 250 }))).matches).toEqual([])
	})

	it('ignores tone A followed by B after a long gap', () => {
		expect(
			detect(render([{ tone: STATION_1.a, ms: 1000 }, { silence: 1500 }, { tone: STATION_1.b, ms: 3000 }])).matches,
		).toEqual([])
	})

	it('accepts tones that drift within tolerance', () => {
		expect(detect(render(page(STATION_1, { detune: 0.01 }))).matches).toEqual(['Station 1'])
		expect(detect(render(page(STATION_1, { detune: -0.01 }))).matches).toEqual(['Station 1'])
	})

	it('rejects tones off by more than the table spacing', () => {
		expect(detect(render(page(STATION_1, { detune: 0.03 }))).matches).toEqual([])
	})

	it('works through background hiss and mains hum', () => {
		const audio = render([{ silence: 300 }, ...page(STATION_1)], 0.15)
		const hum = Float32Array.from(audio, (v, i) => v + 0.2 * Math.sin((2 * Math.PI * 60 * i) / FS))
		expect(detect(hum).matches).toEqual(['Station 1'])
	})

	it('rides out a brief dropout in a tone', () => {
		const audio = render([
			{ tone: STATION_1.a, ms: 1000 },
			{ tone: STATION_1.b, ms: 400 },
			{ silence: 80 },
			{ tone: STATION_1.b, ms: 2000 },
		])
		expect(detect(audio).matches).toEqual(['Station 1'])
	})

	it('works with a quiet feed and other sample rates', () => {
		const set = STATION_1
		const fs = 44_100
		const audio = render([{ tone: set.a, ms: 1000, amp: 0.02 }, { tone: set.b, ms: 3000, amp: 0.02 }], 0, fs)
		const matches: string[] = []
		const d = createPagerToneDetector({ sampleRate: fs, sets: [set], onMatch: (s) => matches.push(s.label) })
		d.process(audio)
		expect(matches).toEqual(['Station 1'])
	})

	it('stays quiet through speech, noise and silence', () => {
		const audio = render([
			{ speech: 8000 },
			{ noise: 3000 },
			{ silence: 1000 },
			{ speech: 8000 },
		], 0.02)
		const { matches, tones } = detect(audio)
		expect(matches).toEqual([])
		expect(tones).toEqual([])
	})

	it('still hears the page when dispatch voice follows straight after', () => {
		const { matches } = detect(render([...page(STATION_1, { bMs: 2000 }), { speech: 5000 }]))
		expect(matches).toEqual(['Station 1'])
	})

	it('reports each configured tone it hears, for setup screens', () => {
		const { tones } = detect(render(page(STATION_1)))
		expect(tones).toEqual([STATION_1.a, STATION_1.b])
	})

	it('handles sets that share a tone', () => {
		const sharedA: PagerToneSet = { a: STATION_1.a, b: 832.5, label: 'Shared A' }
		const { matches } = detect(render(page(sharedA)), [STATION_1, sharedA])
		expect(matches).toEqual(['Shared A'])
	})

	it('does nothing with no sets configured', () => {
		expect(detect(render(page(STATION_1)), []).matches).toEqual([])
	})
})
