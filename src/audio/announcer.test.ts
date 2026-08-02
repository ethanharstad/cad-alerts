import { describe, it, expect } from 'vitest'

import { createAlertAnnouncer, ACTIONABLE_WINDOW_MS } from './announcer'
import type { Alert } from '../../shared/types'

const NOW = 1_000_000_000

function alert(id: string, timestamp = NOW): Alert {
	return {
		alert_id: id,
		organization: 'o1',
		body: '',
		audio_url: `${id}.mp3`,
		timestamp,
		updated_at: timestamp,
		source: '',
		nature: '',
		address: '',
		city: '',
		latitude: null,
		longitude: null,
	}
}

// A `speak` whose playback the test resolves by hand, so what is spoken and what
// merely waits are both observable.
function controllableSpeaker() {
	const spoken: string[] = []
	let finish: (() => void) | null = null
	const speak = (a: Alert) => {
		spoken.push(a.alert_id)
		return new Promise<void>((resolve) => {
			finish = resolve
		})
	}
	const finishOne = async () => {
		finish?.()
		await Promise.resolve()
		await Promise.resolve()
	}
	return { spoken, speak, finishOne }
}

const announcerAt = (speak: (a: Alert) => Promise<void>) =>
	createAlertAnnouncer(speak, () => NOW)

describe('createAlertAnnouncer', () => {
	it('speaks a fresh alert', async () => {
		const { spoken, speak } = controllableSpeaker()
		announcerAt(speak).announce(alert('a'))
		expect(spoken).toEqual(['a'])
	})

	it('skips an alert older than the actionable window', () => {
		const { spoken, speak } = controllableSpeaker()
		announcerAt(speak).announce(alert('stale', NOW - ACTIONABLE_WINDOW_MS - 1))
		expect(spoken).toEqual([])
	})

	it('speaks an alert right at the edge of the window', () => {
		const { spoken, speak } = controllableSpeaker()
		announcerAt(speak).announce(alert('edge', NOW - ACTIONABLE_WINDOW_MS))
		expect(spoken).toEqual(['edge'])
	})

	it('speaks only the newest of a backlog offered at once', async () => {
		const { spoken, speak, finishOne } = controllableSpeaker()
		const announcer = announcerAt(speak)

		// A catch-up feeds the whole recent list, oldest first. The first is spoken
		// immediately (nothing else is playing); the rest must collapse to one.
		announcer.announce(alert('old', NOW - 3000))
		announcer.announce(alert('newer', NOW - 2000))
		announcer.announce(alert('newest', NOW - 1000))

		expect(spoken).toEqual(['old'])
		await finishOne()
		expect(spoken).toEqual(['old', 'newest'])

		// 'newer' was displaced, and nothing is left over.
		await finishOne()
		expect(spoken).toEqual(['old', 'newest'])
	})

	it('does not let an older alert displace a newer one already waiting', async () => {
		const { spoken, speak, finishOne } = controllableSpeaker()
		const announcer = announcerAt(speak)

		announcer.announce(alert('playing', NOW - 4000))
		announcer.announce(alert('newest', NOW - 1000))
		announcer.announce(alert('straggler', NOW - 2000))

		await finishOne()
		expect(spoken).toEqual(['playing', 'newest'])
	})

	it('lets the alert being spoken finish rather than cutting it off', async () => {
		const { spoken, speak, finishOne } = controllableSpeaker()
		const announcer = announcerAt(speak)

		announcer.announce(alert('first', NOW - 2000))
		announcer.announce(alert('second', NOW - 1000))
		// 'second' is newer, but 'first' is mid-word — it is not interrupted.
		expect(spoken).toEqual(['first'])
		await finishOne()
		expect(spoken).toEqual(['first', 'second'])
	})

	it('keeps working when an alert fails to play', async () => {
		const attempted: string[] = []
		const announcer = createAlertAnnouncer(async (a) => {
			attempted.push(a.alert_id)
			if (a.alert_id === 'bad') throw new Error('audio fetch failed')
		}, () => NOW)

		announcer.announce(alert('bad'))
		await new Promise((resolve) => setTimeout(resolve, 0))
		announcer.announce(alert('good'))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(attempted).toEqual(['bad', 'good'])
	})

	it('clear drops what is waiting but not what is playing', async () => {
		const { spoken, speak, finishOne } = controllableSpeaker()
		const announcer = announcerAt(speak)

		announcer.announce(alert('playing', NOW - 2000))
		announcer.announce(alert('waiting', NOW - 1000))
		expect(announcer.hasPending).toBe(true)

		announcer.clear()
		expect(announcer.hasPending).toBe(false)

		await finishOne()
		expect(spoken).toEqual(['playing'])
	})
})
