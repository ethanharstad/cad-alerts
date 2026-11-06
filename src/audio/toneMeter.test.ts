import { describe, it, expect } from 'vitest'

import { createToneMeter, type MeasuredTone } from './toneMeter'

const FS = 48_000

function rng(seed = 3) {
	let s = seed
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0
		return s / 2 ** 32 - 0.5
	}
}

type Segment = { tone: number; ms: number; amp?: number } | { silence: number } | { noise: number }

function render(segments: Segment[], hiss = 0, fs = FS): Float32Array {
	const rand = rng()
	const out: number[] = []
	let phase = 0
	for (const seg of segments) {
		const ms = 'tone' in seg ? seg.ms : 'silence' in seg ? seg.silence : seg.noise
		const count = Math.round((ms / 1000) * fs)
		for (let i = 0; i < count; i++) {
			let x = hiss * rand()
			if ('tone' in seg) {
				x += (seg.amp ?? 0.5) * Math.sin(phase)
				phase += (2 * Math.PI * seg.tone) / fs
			} else if ('noise' in seg) {
				x += 0.5 * rand()
			}
			out.push(x)
		}
	}
	return new Float32Array(out)
}

function measure(samples: Float32Array, fs = FS): MeasuredTone[] {
	const tones: MeasuredTone[] = []
	const meter = createToneMeter({ sampleRate: fs, onTone: (t) => tones.push(t) })
	meter.process(samples)
	meter.flush()
	return tones
}

describe('createToneMeter', () => {
	it('measures both tones of a page, with their lengths', () => {
		const tones = measure(
			render([{ silence: 200 }, { tone: 330.5, ms: 1000 }, { tone: 569.1, ms: 3000 }, { silence: 500 }], 0.002),
		)
		expect(tones).toHaveLength(2)
		expect(tones[0]!.hz).toBeCloseTo(330.5, 0)
		expect(tones[0]!.ms).toBeGreaterThanOrEqual(900)
		expect(tones[0]!.ms).toBeLessThanOrEqual(1050)
		expect(tones[1]!.hz).toBeCloseTo(569.1, 0)
		expect(tones[1]!.ms).toBeGreaterThanOrEqual(2900)
	})

	it('measures a tone the decoder would not know, precisely enough to compare', () => {
		const [tone] = measure(render([{ tone: 1153.4 * 1.03, ms: 1000 }], 0.002))
		expect(Math.abs(tone!.hz - 1153.4 * 1.03)).toBeLessThan(1)
	})

	it('measures high tones and other sample rates', () => {
		const [tone] = measure(render([{ tone: 2468.2, ms: 800, amp: 0.05 }], 0.001, 44_100), 44_100)
		expect(Math.abs(tone!.hz - 2468.2)).toBeLessThan(2)
		expect(tone!.dbfs).toBeCloseTo(-29, -1)
	})

	it('ignores noise, silence and blips too short to be a tone', () => {
		expect(measure(render([{ noise: 2000 }, { silence: 1000 }, { tone: 800, ms: 150 }, { silence: 500 }]))).toEqual([])
	})

	it('reports a tone still going on flush', () => {
		const tones: MeasuredTone[] = []
		const meter = createToneMeter({ sampleRate: FS, onTone: (t) => tones.push(t) })
		meter.process(render([{ tone: 700, ms: 600 }]))
		expect(tones).toEqual([])
		meter.flush()
		expect(tones).toHaveLength(1)
	})
})
