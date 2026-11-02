import type { PagerToneSet } from '../../shared/pagerTones'
import { createPagerToneDetector } from './pagerToneDetector'
import { listDevices, matchSavedDevice } from './outputDevice'

/**
 * Listens to the pager audio — the pager's or receiver's audio out, wired into
 * this computer's line-in or a USB sound card — and reports when one of the
 * department's tone sets is sent (see `pagerToneDetector.ts`).
 *
 * The capture side is deliberately thin: an AudioWorklet that only copies
 * samples to the page, where the detector runs. Everything that can be tested
 * without a browser lives in the detector.
 */

export type PagerMonitorStatus =
	/** Opening the input. */
	| 'starting'
	/** Capturing and decoding. */
	| 'listening'
	/**
	 * The browser has not let audio processing start yet (autoplay policy);
	 * the next tap or keypress on the page lets it start.
	 */
	| 'suspended'
	/** No input: permission refused, device missing or unplugged. */
	| 'unavailable'
	| 'stopped'

export interface PagerMonitorOptions {
	/** Input device id; '' uses the system default input. */
	deviceId: string
	/**
	 * The saved device's label. Browsers re-issue device ids (when site data is
	 * cleared, say), so a saved id that no longer matches falls back to the one
	 * input with this label.
	 */
	deviceLabel?: string
	/** Called when the saved id was re-issued, so the caller can store the new one. */
	onDeviceIdChange?: (deviceId: string) => void
	sets: readonly PagerToneSet[]
	onMatch: (set: PagerToneSet) => void
	onTone?: (hz: number) => void
	onStatus?: (status: PagerMonitorStatus, detail?: string) => void
	/** Input level in dBFS, about ten times a second, for a level meter. */
	onLevel?: (dbfs: number) => void
}

export interface PagerMonitor {
	readonly status: PagerMonitorStatus
	/** Try to start audio processing again; call from a user gesture. */
	resume(): Promise<void>
	/**
	 * Release the input and stop decoding. Safe at any time — including while
	 * the input is still opening, in which case whatever it opens is released as
	 * soon as it arrives — and safe to call twice.
	 */
	stop(): void
}

/** Whether this browser can capture and process audio input at all. */
export function supportsPagerMonitor(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof AudioContext !== 'undefined' &&
		typeof AudioWorkletNode !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia
	)
}

// Batches the 128-sample render quanta into larger chunks before posting, so
// the page gets a message every ~40 ms instead of ~370 times a second.
const TAP_PROCESSOR = `
class PagerTap extends AudioWorkletProcessor {
	constructor() {
		super()
		this.buffer = new Float32Array(2048)
		this.filled = 0
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0]
		if (channel) {
			let i = 0
			while (i < channel.length) {
				const n = Math.min(channel.length - i, this.buffer.length - this.filled)
				this.buffer.set(channel.subarray(i, i + n), this.filled)
				this.filled += n
				i += n
				if (this.filled === this.buffer.length) {
					this.port.postMessage(this.buffer, [this.buffer.buffer])
					this.buffer = new Float32Array(2048)
					this.filled = 0
				}
			}
		}
		return true
	}
}
registerProcessor('pager-tap', PagerTap)
`

const LEVEL_INTERVAL_MS = 100

/**
 * Start listening. Returns at once, with status `starting`, and opens the input
 * in the background, so the caller always holds a handle it can stop — there is
 * no window in which a start can be superseded or abandoned and leave the
 * microphone open. Never throws: a failure is reported as status `unavailable`
 * with a reason, so a dashboard can say so and carry on.
 */
export function startPagerMonitor(options: PagerMonitorOptions): PagerMonitor {
	let status: PagerMonitorStatus = 'starting'
	let stopped = false
	let inputLost = false
	let stream: MediaStream | null = null
	let ctx: AudioContext | null = null

	const setStatus = (next: PagerMonitorStatus, detail?: string) => {
		if (stopped && next !== 'stopped') return
		status = next
		options.onStatus?.(next, detail)
	}

	const release = () => {
		for (const track of stream?.getTracks() ?? []) track.stop()
		void ctx?.close().catch(() => {})
	}

	const monitor: PagerMonitor = {
		get status() {
			return status
		},
		async resume() {
			if (!stopped && ctx && ctx.state === 'suspended') {
				try {
					await ctx.resume()
				} catch {
					// Still blocked; the next gesture tries again.
				}
			}
		},
		stop() {
			if (stopped) return
			setStatus('stopped')
			stopped = true
			release()
		},
	}

	const open = async () => {
		// Follow the saved input if the browser has re-issued its id.
		let deviceId = options.deviceId
		const resolved = await matchSavedDevice(
			() => listDevices('audioinput', 'Input'),
			deviceId,
			options.deviceLabel ?? '',
		)
		if (stopped) return
		if (resolved && resolved !== deviceId) {
			deviceId = resolved
			options.onDeviceIdChange?.(resolved)
		}

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					deviceId: deviceId ? { exact: deviceId } : undefined,
					// The speech processing browsers apply by default treats a steady
					// tone as noise and removes it. Turn all of it off.
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					channelCount: 1,
				},
			})
		} catch (err) {
			const name = err instanceof Error ? err.name : ''
			setStatus(
				'unavailable',
				name === 'OverconstrainedError' || name === 'NotFoundError'
					? 'The pager audio input was not found'
					: name === 'NotAllowedError'
						? 'The browser did not allow access to the pager audio input'
						: 'The pager audio input could not be opened',
			)
			return
		}
		// Stopped while the input was opening: let it go straight away.
		if (stopped) return release()

		for (const track of stream.getAudioTracks()) {
			track.addEventListener('ended', () => {
				inputLost = true
				setStatus('unavailable', 'The pager audio input was disconnected')
			})
		}

		try {
			ctx = new AudioContext()
			const moduleUrl = URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: 'application/javascript' }))
			try {
				await ctx.audioWorklet.addModule(moduleUrl)
			} finally {
				URL.revokeObjectURL(moduleUrl)
			}
			if (stopped) return release()

			const detector = createPagerToneDetector({
				sampleRate: ctx.sampleRate,
				sets: options.sets,
				onMatch: (set) => {
					if (!stopped) options.onMatch(set)
				},
				onTone: options.onTone,
			})

			const source = ctx.createMediaStreamSource(stream)
			const tap = new AudioWorkletNode(ctx, 'pager-tap', { numberOfOutputs: 1 })
			// Pull the tap through a muted gain so the graph is rendered; nothing is
			// actually played back.
			const mute = ctx.createGain()
			mute.gain.value = 0
			source.connect(tap).connect(mute).connect(ctx.destination)

			let sumSquares = 0
			let count = 0
			let lastLevel = 0
			tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
				if (stopped) return
				const samples = event.data
				detector.process(samples)
				if (!options.onLevel) return
				for (let i = 0; i < samples.length; i++) sumSquares += samples[i]! * samples[i]!
				count += samples.length
				const now = performance.now()
				if (now - lastLevel >= LEVEL_INTERVAL_MS) {
					const rms = Math.sqrt(sumSquares / Math.max(1, count))
					options.onLevel(rms > 0 ? 20 * Math.log10(rms) : -Infinity)
					sumSquares = 0
					count = 0
					lastLevel = now
				}
			}

			const reportState = () => {
				if (stopped || inputLost || !ctx) return
				setStatus(ctx.state === 'running' ? 'listening' : 'suspended')
			}
			ctx.addEventListener('statechange', reportState)
			await monitor.resume()
			reportState()
		} catch (err) {
			if (stopped) return
			console.error('Pager monitor failed to start:', err)
			release()
			setStatus('unavailable', 'This browser could not process the pager audio')
		}
	}

	void open()
	return monitor
}
