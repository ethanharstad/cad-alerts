import { describe, it, expect, beforeEach } from 'vitest'

import { audioBlocked, notePlayResult, probeAudio } from './autoplay'

function playError(name: string) {
  const err = new Error(name)
  err.name = name
  return err
}

describe('autoplay detection', () => {
  beforeEach(() => {
    audioBlocked.value = false
  })

  it('flags audio as blocked when the browser refuses to play', async () => {
    const played = await probeAudio(() => ({ play: () => Promise.reject(playError('NotAllowedError')) }))
    expect(played).toBe(false)
    expect(audioBlocked.value).toBe(true)
  })

  it('clears the flag once a clip plays', async () => {
    audioBlocked.value = true
    const played = await probeAudio(() => ({ play: () => Promise.resolve() }))
    expect(played).toBe(true)
    expect(audioBlocked.value).toBe(false)
  })

  it('probes with a playable WAV data URL', async () => {
    let url = ''
    await probeAudio((u) => {
      url = u
      return { play: () => Promise.resolve() }
    })
    expect(url).toMatch(/^data:audio\/wav;base64,/)
    expect(atob(url.split(',')[1]!).slice(0, 4)).toBe('RIFF')
  })

  it('does not treat other playback failures as a block', () => {
    notePlayResult(playError('NotSupportedError'))
    expect(audioBlocked.value).toBe(false)

    audioBlocked.value = true
    notePlayResult(playError('AbortError'))
    expect(audioBlocked.value).toBe(true)
  })
})
